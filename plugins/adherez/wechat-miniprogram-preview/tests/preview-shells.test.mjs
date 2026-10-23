import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreviewShells } from '../miniapp/node/preview-shells.mjs';

function fixture() {
  let clock = 0;
  let state = { previewId: 'pv_test', projectId: 'project', serverEpoch: 'epoch', leaseEpoch: 1,
    lease: { clientId: 'client-a', instanceId: 'instance-a', buildId: 'build-a', leaseEpoch: 1 } };
  const service = { snapshot(id) { if (!state || id !== state.previewId) throw Object.assign(new Error('closed'), { code: 'PREVIEW_CONTEXT_NOT_FOUND' }); return structuredClone(state); } };
  const shells = createPreviewShells(service, { now: () => clock });
  const owner = () => state?.lease ? ({ previewId: state.previewId, projectId: state.projectId, serverEpoch: state.serverEpoch, ...state.lease }) : null;
  const channel = (clientId = 'client-a') => shells.register({ previewId: 'pv_test', serverEpoch: 'epoch', clientId, registrationId: 'private-registration-' + clientId }).channelId;
  const report = (channelId, patch = {}) => shells.report(channelId, { revision: 1, identity: owner(), contextLeaseEpoch: state?.leaseEpoch || 0,
    status: 'ready', dirty: false, exportAvailable: true, ...patch });
  const request = (patch = {}) => shells.request({ preview_id: 'pv_test', client_id: 'client-a', state_revision: 1, action: 'export_local', ...patch });
  return { shells, owner, channel, report, request, state: () => state, mutate: (patch) => Object.assign(state, patch), close: () => { state = null; }, advance: (n) => { clock += n; } };
}

test('recovery metadata stays separate from private channel and targets only the selected Shell', () => {
  const f = fixture(), a = f.channel(), b = f.channel('client-b'), heardA = [], heardB = [];
  f.shells.subscribe(a, (...args) => heardA.push(args)); f.shells.subscribe(b, (...args) => heardB.push(args));
  f.report(a); f.report(b, { identity: null, status: 'waiting' });
  const list = f.shells.list('pv_test');
  assert.doesNotMatch(JSON.stringify(list), new RegExp(a + '|' + b));
  assert.deepEqual(list[0].availableActions, ['export_local', 'close']);
  const accepted = f.request(); assert.equal(accepted.status, 'pending');
  assert.equal(heardA.length, 1); assert.equal(heardB.length, 0);
  assert.deepEqual(heardA[0][1].identity, f.owner());
  f.shells.acknowledge(a, { requestId: accepted.requestId, stateRevision: 1, status: 'export_requested' });
  assert.equal(f.shells.list('pv_test')[0].lastCommand.status, 'export_requested');
  assert.equal(Object.hasOwn(list[0], 'storage'), false);
});

test('stale revision, forged identities and unconfirmed destructive actions are refused', () => {
  const f = fixture(), a = f.channel(); f.shells.subscribe(a, () => {}); f.report(a, { status: 'storage_conflict', dirty: true });
  assert.throws(() => f.request({ state_revision: 0 }), { code: 'STALE_SHELL_STATE' });
  assert.throws(() => f.request({ action: 'discard_local' }), { code: 'CONFIRMATION_REQUIRED' });
  assert.throws(() => f.report(a, { revision: 2, identity: { ...f.owner(), clientId: 'other' } }), { code: 'STALE_FRAME' });
  assert.throws(() => f.report(a, { revision: 2, identity: { ...f.owner(), instanceId: 'forged' } }), { code: 'STALE_FRAME' });
  const accepted = f.request({ action: 'discard_local', confirmed: true });
  assert.throws(() => f.shells.acknowledge(a, { requestId: accepted.requestId, stateRevision: 2, status: 'completed' }), { code: 'STALE_SHELL_STATE' });
  assert.throws(() => f.request({ action: 'discard_local', confirmed: true }), { code: 'RECOVERY_IN_PROGRESS' });
});

test('an old owner may export its local snapshot but cannot operate the new lease', () => {
  const f = fixture(), a = f.channel(); f.shells.subscribe(a, () => {}); f.report(a);
  const old = f.owner(); f.mutate({ leaseEpoch: 2, lease: { clientId: 'client-b', instanceId: 'instance-b', buildId: 'build-a', leaseEpoch: 2 } });
  f.report(a, { revision: 2, identity: old, contextLeaseEpoch: 2, status: 'ownership_lost', dirty: true });
  assert.deepEqual(f.shells.list('pv_test')[0].availableActions, ['export_local', 'takeover']);
  assert.throws(() => f.request({ state_revision: 2, action: 'discard_local', confirmed: true }), { code: 'RECOVERY_NOT_AVAILABLE' });
  assert.throws(() => f.request({ state_revision: 2, action: 'takeover' }), { code: 'CONFIRMATION_REQUIRED' });
  f.close();
  f.report(a, { revision: 3, identity: null, contextLeaseEpoch: 3, status: 'closed', dirty: true });
  assert.deepEqual(f.shells.list('pv_test')[0].availableActions, ['export_local']);
  assert.throws(() => f.request({ state_revision: 3, action: 'close', confirmed: true }), { code: 'RECOVERY_NOT_AVAILABLE' });
  assert.equal(f.request({ state_revision: 3 }).accepted, true);
});

test('a reconnect target can retry committed handoff while old frame identity remains retired', () => {
  const f = fixture(), a = f.channel(); f.shells.subscribe(a, () => {}); f.report(a);
  const old = f.owner();
  f.mutate({ leaseEpoch: 2, lease: null, recovering: { targetClientId: 'client-a', operationId: 'op-handoff' } });
  f.report(a, { revision: 2, identity: old, contextLeaseEpoch: 2, status: 'outcome_unknown', operationId: 'op-handoff' });
  assert.deepEqual(f.shells.list('pv_test')[0].availableActions, ['export_local', 'retry']);
  assert.equal(f.request({ state_revision: 2, action: 'retry' }).accepted, true);
});

test('lost handoff response can reconcile the same client operation despite the reported old epoch', () => {
  const f = fixture(), a = f.channel(); f.shells.subscribe(a, () => {}); f.report(a);
  const old = f.owner();
  f.mutate({ leaseEpoch: 2, lease: { clientId: 'client-a', instanceId: 'instance-new', buildId: 'build-a', leaseEpoch: 2 } });
  f.report(a, { revision: 2, identity: old, contextLeaseEpoch: 1, status: 'outcome_unknown', operationId: 'lost-frame-operation' });
  assert.deepEqual(f.shells.list('pv_test')[0].availableActions, ['export_local', 'retry']);
  assert.equal(f.request({ state_revision: 2, action: 'retry' }).accepted, true);
});

test('an unknown close result can query its original operation after the context has closed', () => {
  const f = fixture(), a = f.channel(); f.shells.subscribe(a, () => {}); f.report(a);
  const old = f.owner(); f.close();
  f.report(a, { revision: 2, identity: old, contextLeaseEpoch: 1, status: 'outcome_unknown', operationId: 'lost-close-operation' });
  assert.deepEqual(f.shells.list('pv_test')[0].availableActions, ['export_local', 'retry']);
  assert.throws(() => f.request({ state_revision: 2, action: 'takeover', confirmed: true }), { code: 'RECOVERY_NOT_AVAILABLE' });
  assert.equal(f.request({ state_revision: 2, action: 'retry' }).accepted, true);
});

test('uncertain delivery cannot be silently repeated; idempotent receipts survive changing reports', () => {
  const f = fixture(), a = f.channel(), heard = []; const disconnect = f.shells.subscribe(a, (...args) => heard.push(args)); f.report(a);
  const requestId = 'recover-one'; f.request({ request_id: requestId });
  f.advance(16000);
  assert.equal(f.shells.list('pv_test')[0].lastCommand.status, 'unconfirmed');
  assert.throws(() => f.request({ request_id: 'new-operation' }), { code: 'RECOVERY_IN_PROGRESS' });
  assert.equal(f.request({ request_id: requestId }).replayed, true); assert.equal(heard.length, 2);
  assert.deepEqual(heard[0], heard[1]);
  assert.throws(() => f.request({ request_id: requestId, action: 'close', confirmed: true }), { code: 'OPERATION_ID_REUSED' });
  f.shells.acknowledge(a, { requestId, stateRevision: 1, status: 'export_requested' });
  f.report(a, { revision: 2 });
  assert.equal(f.request({ request_id: requestId }).status, 'export_requested');
  disconnect(); assert.throws(() => f.request({ state_revision: 2 }), { code: 'SHELL_UNAVAILABLE' });
  f.advance(31 * 60 * 1000); assert.deepEqual(f.shells.list('pv_test'), []);
});

test('channels are bounded and an inactive frame cannot reconnect by inventing a lease', () => {
  const f = fixture();
  for (let i = 0; i < 32; i++) { f.channel('client-' + i); f.advance(31000); }
  assert.throws(() => f.channel('client-overflow'), { code: 'PREVIEW_CAPACITY_REACHED' });
  f.advance(31 * 60 * 1000); const channel = f.channel('client-a'); f.shells.subscribe(channel, () => {});
  f.mutate({ lease: null, leaseEpoch: 2 });
  f.report(channel, { identity: null, contextLeaseEpoch: 2, status: 'ownership_lost', dirty: true });
  assert.ok(f.shells.list('pv_test')[0].availableActions.includes('takeover'));
  assert.throws(() => f.request({ action: 'takeover' }), { code: 'CONFIRMATION_REQUIRED' });
  assert.equal(f.request({ action: 'takeover', confirmed: true }).accepted, true);
  f.shells.dispose(); assert.throws(() => f.channel('client-new'), { code: 'PREVIEW_STOPPING' });
});

test('four reserved live Shells leave HTTP connection headroom and disconnected slots can be reused', () => {
  const f = fixture(), channels = [];
  for (let i = 0; i < 4; i++) channels.push(f.channel('client-' + i));
  assert.throws(() => f.channel('client-overflow'), { code: 'SHELL_CAPACITY_REACHED' });
  const release = f.shells.subscribe(channels[0], () => {}); release();
  assert.equal(typeof f.channel('client-next'), 'string');
  assert.throws(() => f.shells.subscribe(channels[0], () => {}), { code: 'SHELL_CAPACITY_REACHED' });
});

test('registration retry is private and idempotent; changed project retires the old channel', () => {
  const f = fixture(), a = f.channel(), heard = [];
  f.shells.subscribe(a, (...args) => heard.push(args)); f.report(a);
  assert.equal(f.channel(), a);
  assert.throws(() => f.shells.register({ previewId: 'pv_test', serverEpoch: 'epoch', clientId: 'client-a', registrationId: 'wrong-private-registration' }), { code: 'SHELL_ALREADY_REGISTERED' });
  assert.doesNotMatch(JSON.stringify(f.shells.list('pv_test')), /private-registration/);
  f.mutate({ projectId: 'project-b', lease: null, leaseEpoch: 2 });
  const b = f.channel(); assert.notEqual(a, b);
  assert.equal(heard[0][0], 'channel-retired');
  assert.throws(() => f.report(a), { code: 'SHELL_UNAVAILABLE' });
});

test('late first owner report and changed-project retirement preserve only the original local export', () => {
  const f = fixture(), a = f.channel(); f.shells.subscribe(a, () => {});
  f.report(a, { identity: null, contextLeaseEpoch: 0, status: 'waiting', exportAvailable: false });
  const old = f.owner();
  f.mutate({ leaseEpoch: 2, lease: { clientId: 'client-b', instanceId: 'instance-b', buildId: 'build-a', leaseEpoch: 2 } });
  f.report(a, { revision: 2, identity: old, contextLeaseEpoch: 2, status: 'ownership_lost', dirty: true });
  assert.ok(f.shells.list('pv_test')[0].availableActions.includes('export_local'));
  f.mutate({ projectId: 'project-b', leaseEpoch: 3, lease: null });
  f.report(a, { revision: 3, identity: old, contextLeaseEpoch: 2, status: 'ownership_lost', dirty: true });
  assert.deepEqual(f.shells.list('pv_test')[0].availableActions, ['export_local']);
  assert.equal(f.shells.list('pv_test')[0].projectId, 'project');
  assert.throws(() => f.request({ state_revision: 3, action: 'takeover', confirmed: true }), { code: 'RECOVERY_NOT_AVAILABLE' });
});
