/**
 * Token signing for relay peers.
 *
 * The relay never holds a MiniMax account credential. It issues device-scoped tokens
 * signed with a shared HMAC key, and the bridge signs its own token the same way. Both
 * sides only need to prove they are who the relay paired them as.
 *
 * This lives in the shared protocol package rather than in the relay because the
 * token format is a contract between three runtimes: the relay issues and verifies
 * device tokens, the desktop presents a bridge token, and an operator has to mint
 * that bridge token from the same secret. It is also deliberately free of any
 * Node-only API, so it runs unchanged in the browser, in a Worker and in a script.
 */
const encoder = new TextEncoder();
function base64UrlEncode(bytes) {
    let binary = '';
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64UrlDecode(value) {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/');
    const base64 = padded + '='.repeat((4 - (padded.length % 4)) % 4);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }
    // `new Uint8Array(n)` always allocates a plain ArrayBuffer, never a SharedArrayBuffer.
    return bytes.buffer;
}
async function hmacKey(secret) {
    const subtle = globalThis.crypto.subtle;
    return subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
/** Signs a token payload. The result is `base64url(payload).base64url(signature)`. */
export async function signToken(payload, secret) {
    const key = await hmacKey(secret);
    const body = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
    const signature = await globalThis.crypto.subtle.sign('HMAC', key, encoder.encode(body));
    return `${body}.${base64UrlEncode(new Uint8Array(signature))}`;
}
/**
 * Verifies a token.
 *
 * Returns `null` for anything that is not a well-formed, correctly signed, unexpired
 * token. Callers must treat `null` as "not authorized" and never as a partial success.
 */
export async function verifyToken(token, secret) {
    if (typeof token !== 'string' || token.length === 0)
        return null;
    const dot = token.indexOf('.');
    if (dot <= 0 || dot === token.length - 1)
        return null;
    const body = token.slice(0, dot);
    const signature = token.slice(dot + 1);
    let valid = false;
    try {
        const key = await hmacKey(secret);
        valid = await globalThis.crypto.subtle.verify('HMAC', key, base64UrlDecode(signature), encoder.encode(body));
    }
    catch {
        return null;
    }
    if (!valid)
        return null;
    let payload;
    try {
        payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(body)));
    }
    catch {
        return null;
    }
    if (!payload || payload.v !== 1)
        return null;
    if (payload.role !== 'bridge' && payload.role !== 'device')
        return null;
    if (typeof payload.sub !== 'string' || !payload.sub)
        return null;
    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp))
        return null;
    if (payload.exp <= Date.now())
        return null;
    // A bridge token has to name the account it belongs to. An unbound bridge
    // token would be a credential for every room on the relay, so one without
    // the claim is not a token at all.
    if (payload.role === 'bridge' && (typeof payload.acc !== 'string' || !payload.acc)) {
        return null;
    }
    return payload;
}
/** Builds and signs a token in one step. */
export async function issueToken(sub, role, ttlMs, secret, options = {}) {
    const now = options.now ?? Date.now();
    const expiresAt = now + ttlMs;
    const payload = {
        v: 1,
        sub,
        role,
        exp: expiresAt,
        jti: newTokenId(now),
        iat: now,
    };
    if (options.accountId) {
        payload.acc = options.accountId;
    }
    if (options.ticket) {
        payload.tick = true;
    }
    return { token: await signToken(payload, secret), expiresAt };
}
function newTokenId(now) {
    const cryptoObj = globalThis.crypto;
    if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
        return cryptoObj.randomUUID();
    }
    return `${now.toString(36)}${Math.floor(Math.random() * 0xffffff).toString(16)}`;
}
//# sourceMappingURL=auth.js.map