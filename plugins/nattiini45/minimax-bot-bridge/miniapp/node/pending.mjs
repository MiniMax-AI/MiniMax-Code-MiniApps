/**
 * Pending approvals and questions.
 *
 * A turn that stops for a permission check or a questionnaire is held by the desktop, not
 * by the socket, so the phone can answer it minutes later — or after a reconnect. The
 * pending set is re-emitted whenever a device resumes so a phone that was offline still
 * sees the request.
 */

const DEFAULT_TTL_MS = 10 * 60 * 1000;

export class PendingSet {
  constructor({ ttlMs = DEFAULT_TTL_MS, now = () => Date.now() } = {}) {
    this.ttlMs = ttlMs;
    this.now = now;
    /** @type {Map<string, import('./contracts.d.ts').PendingItem>} */
    this.items = new Map();
    /** The token of the last claim, so that no two claims share one. */
    this.claimCounter = 0;
    /** Resolved ids retain their original expiry, so event replay cannot reopen them. */
    /** @type {Map<string, import('./contracts.d.ts').PendingItem>} */
    this.resolved = new Map();
    this.onExpired = (_id, _item) => {};
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    this.expiryTimer = undefined;
  }

  /** @param {'permission'|'question'} kind @param {import('./contracts.d.ts').PendingRequest} request @param {string} sessionId */
  add(kind, request, sessionId) {
    this.expire();
    const previous = this.items.get(request.requestId) ?? this.resolved.get(request.requestId);
    if (previous) return { ...previous.request, expiresAt: previous.expiresAt };
    const retainedUntil = this.now() + this.ttlMs;
    const expiresAt = typeof request.expiresAt === 'number' && Number.isFinite(request.expiresAt)
      ? Math.min(retainedUntil, request.expiresAt) : retainedUntil;
    this.items.set(request.requestId, { kind, request, sessionId, expiresAt });
    this.scheduleExpiry();
    return { ...request, expiresAt };
  }

  seen(requestId) {
    this.expire();
    return this.items.has(requestId) || this.resolved.has(requestId);
  }

  get(requestId) {
    this.expire();
    return this.items.get(requestId);
  }

  /**
   * Claims a request for an answer.
   *
   * The claim is taken before the Host is called, so a second answer to the same
   * request finds nothing to answer and is refused. Without the claim, both answers
   * pass the lookup and both reach the Host, and a phone that double-taps the approve
   * button produces two answers rather than one.
   *
   * The claim carries a token, so that a caller can only give back a claim that is
   * its own: a request whose id was reused while a claim was in flight would
   * otherwise be released by the wrong caller.
   *
   * @param {string} requestId
   * @param {'permission'|'question'} [kind]
   * @returns the claimed item, or undefined when there is nothing to claim
   */
  claim(requestId, kind) {
    this.expire();
    const item = this.items.get(requestId);
    if (!item) return undefined;
    if (kind && item.kind !== kind) return undefined;
    if (item.claimed) return undefined;
    this.claimCounter += 1;
    item.claimed = true;
    item.claimId = this.claimCounter;
    return item;
  }

  /**
   * Gives a claimed request back, so that it can be answered again.
   *
   * This is for the case where the Host did not take the answer: the request is still
   * waiting for one, and the phone is allowed to give it.
   *
   * @param {string} requestId
   * @param {number} [claimId] the token of the claim being given back
   */
  release(requestId, claimId) {
    const item = this.items.get(requestId);
    if (!item) return false;
    // Only the holder of the claim may give it back.
    if (claimId !== undefined && item.claimId !== claimId) return false;
    item.claimed = false;
    item.claimId = undefined;
    return true;
  }

  /**
   * The requests that are waiting for an answer.
   *
   * A request that is being answered right now is not waiting for one, so it is not
   * listed: a phone that reconnects must not be shown a request that cannot be
   * answered.
   *
   * @param {'permission'|'question'} [kind]
   */
  listUnclaimed(kind) {
    this.expire();
    const all = [...this.items.values()].filter((item) => !item.claimed);
    return kind ? all.filter((item) => item.kind === kind) : all;
  }

  resolve(requestId) {
    this.expire();
    const item = this.items.get(requestId);
    if (!item) return false;
    this.resolved.set(requestId, item);
    this.items.delete(requestId);
    this.scheduleExpiry();
    return true;
  }

  list(kind) {
    this.expire();
    const all = [...this.items.values()];
    return kind ? all.filter((item) => item.kind === kind) : all;
  }

  /** Drops expired requests. Returns the ids that were removed. */
  expire() {
    const now = this.now();
    const removed = [];
    for (const [id, item] of this.items) {
      if (item.expiresAt <= now) {
        this.items.delete(id);
        removed.push(id);
        this.onExpired(id, item);
      }
    }
    for (const [id, item] of this.resolved) {
      if (item.expiresAt <= now) this.resolved.delete(id);
    }
    this.scheduleExpiry();
    return removed;
  }

  /** One unref'd timer resolves stale UI even when no phone makes another call. */
  scheduleExpiry() {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = undefined;
    if (!this.items.size) return;
    let next = Infinity;
    for (const item of this.items.values()) next = Math.min(next, item.expiresAt);
    this.expiryTimer = setTimeout(() => {
      this.expiryTimer = undefined;
      this.expire();
    }, Math.max(1, Math.min(2_147_483_647, next - this.now())));
    this.expiryTimer.unref?.();
  }

  get size() {
    this.expire();
    return this.items.size;
  }
}
