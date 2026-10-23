import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { registerEditor, resetExternalAgentBrokerForTest } from './broker.ts';
import { EXTERNAL_SESSION_TOOLS, externalDraftSchemas, externalGlobalReadSchemas, externalRealSchemas } from '../../src/agent/external-tool-shape.ts';
import { isExternalDraftTool } from '../../src/agent/external-tool-policy.ts';
import { EditSessionOwnershipRegistry } from './edit-session-ownership.ts';
import { fullMcpTools } from './mcp-tool-catalog.ts';
import { initialMcpToolExposure, projectMcpToolExposure } from './mcp-tool-exposure.ts';
import { executeExternalSessionRecovery } from '../../src/agent/external-session-recovery.ts';

const tools = fullMcpTools();
for (const mode of ['full', 'progressive'] as const) {
  const names = projectMcpToolExposure(initialMcpToolExposure(mode), tools, {}).map(t => t.name);
  assert.ok(names.includes('list_edit_sessions'));
  assert.ok(names.includes('recover_edit_session'));
}
const registry = new EditSessionOwnershipRegistry();
const binding = { projectId: 'synthetic', editorInstanceId: 'editor', baseRevision: 'r1', ownershipEpoch: 1 };
const call = { id: 'begin', ownerId: 'transport-a', binding, name: 'begin_edit_session', arguments: {} };
registry.finishApplied(call, { editSessionId: 'draft' });
registry.requireOwned('transport-a', binding, 'draft');
assert.throws(() => registry.requireOwned('transport-b', binding, 'draft'), /EDIT_SESSION_OWNER_ACTIVE/);
const recovery = { ...call, id: 'recover', ownerId: 'transport-b', name: 'recover_edit_session', arguments: { editSessionId: 'draft', action: 'resume' } };
assert.throws(() => registry.reserveRecovery(recovery), /Only an orphaned/);
registry.disconnectOwner('transport-a');
assert.throws(() => registry.requireOwned('transport-b', binding, 'draft'), /EDIT_SESSION_RECOVERY_REQUIRED/);
registry.reserveRecovery(recovery);
assert.throws(() => registry.reserveRecovery({ ...recovery, id: 'race', ownerId: 'transport-c' }), /already being recovered/);
registry.finishApplied(recovery, { editSessionId: 'draft' });
registry.requireOwned('transport-b', binding, 'draft');
assert.throws(() => registry.requireOwned('transport-a', binding, 'draft'), /EDIT_SESSION_OWNER_ACTIVE/);
assert.throws(() => registry.requireOwned('transport-b', { ...binding, baseRevision: 'r2' }, 'draft'), /RECOVERY_REQUIRED/);
// 使用合成草稿验证浏览器恢复执行器：旧 revision 不允许 resume，也不调用 discard。
const draft = { id: 'draft', status: 'drafting', baseRevision: 'r1' };
let discarded = false;
let markedStale = false;
const dependencies = {
  projectId: 'synthetic', sessions: new Map(), currentRevision: () => 'r2',
  info: () => draft, requireSession: () => draft,
  discard: async () => { discarded = true; }, markStale: async () => { markedStale = true; },
} as unknown as Parameters<typeof executeExternalSessionRecovery>[4];
await assert.rejects(executeExternalSessionRecovery('recover_edit_session', { editSessionId: 'draft' }, { action: 'resume' }, binding, dependencies), /revision changed/);
assert.equal(markedStale, true);
assert.equal(discarded, false);
console.log('PASS MiniApp recovery discovery, active-owner rejection, orphan resume, recovery race, old-owner and revision rejection; no discard');

// 使用发布目录的真实 schema 检查宿主上限，避免发现失败后重连丢失草稿归属。
const catalog = JSON.parse(await readFile(new URL('../../assets/agent/openchatcut-tool-schemas.json', import.meta.url), 'utf8')).edit;
resetExternalAgentBrokerForTest();
registerEditor('catalog-check', 'catalog-editor', 'r1', [
  ...externalGlobalReadSchemas(catalog), ...EXTERNAL_SESSION_TOOLS,
  ...externalDraftSchemas(catalog.filter((tool: { name: string }) => isExternalDraftTool(tool.name))),
  ...externalRealSchemas(catalog),
], undefined, null);
const previousMiniApp = process.env.OPENCHATCUT_MINIAPP;
try {
  process.env.OPENCHATCUT_MINIAPP = '1';
  const miniAppTools = fullMcpTools();
  assert.ok(miniAppTools.length <= 128, `MiniApp has ${miniAppTools.length} tools; host limit is 128`);
  for (const name of ['begin_edit_session', 'read_project', 'edit_captions', 'view_asset_frames', 'apply_caption_avoidance', 'review_edit_session']) {
    assert.ok(miniAppTools.some(tool => tool.name === name), `${name} remains discoverable`);
  }
  resetExternalAgentBrokerForTest();
  assert.deepEqual(fullMcpTools(), miniAppTools, 'MiniApp discovery is complete before any editor connects');
  console.log(`PASS MiniApp catalog: ${miniAppTools.length}/128 tools, editing and visual analysis retained`);
} finally {
  if (previousMiniApp === undefined) delete process.env.OPENCHATCUT_MINIAPP;
  else process.env.OPENCHATCUT_MINIAPP = previousMiniApp;
  resetExternalAgentBrokerForTest();
}

// MiniApp 工程共享草稿：连接变化不丢失访问，过期读取与并发写入被拒绝。
{
const shared = new EditSessionOwnershipRegistry(true);
const binding={projectId:'p',editorInstanceId:'e',baseRevision:'r',ownershipEpoch:1};
let i=0;
const call=(ownerId:string,name:string,args={editSessionId:'draft'})=>({id:String(++i),ownerId,binding,name,arguments:args});
shared.finishApplied(call('a','begin_edit_session'),{editSessionId:'draft'});
shared.requireOwned('b',binding,'draft');
assert.throws(()=>shared.reserveRecovery(call('b','edit_item')),/DRAFT_CHANGED/);
const readB=call('b','get_edit_session');shared.reserveRecovery(readB);shared.finishApplied(readB,{});
const writeA=call('a','edit_item');shared.reserveRecovery(writeA);
assert.throws(()=>shared.reserveRecovery(call('b','edit_item')),/DRAFT_BUSY/);
shared.finishApplied(writeA,{});
assert.throws(()=>shared.reserveRecovery(call('b','edit_item')),/DRAFT_CHANGED/);
const reread=call('b','get_edit_session');shared.reserveRecovery(reread);shared.finishApplied(reread,{});
const writeB=call('b','edit_item');shared.reserveRecovery(writeB);shared.finishApplied(writeB,{});
shared.disconnectOwner('a');shared.requireOwned('new-connection',binding,'draft');
assert.throws(()=>shared.requireOwned('b',{...binding,projectId:'other'},'draft'));
const failed=call('b','edit_item');shared.reserveRecovery(failed);shared.releaseRecovery(failed);
const retry=call('b','edit_item');shared.reserveRecovery(retry);shared.releaseRecovery(retry);
shared.requireOwned('after-refresh',{...binding,editorInstanceId:'reloaded',ownershipEpoch:2},'draft');
shared.requireOwned('after-import',{...binding,baseRevision:'newer'},'draft'); // 工程版本冲突仍由编辑器校验，不能误报为其他连接占用。
console.log('PASS shared draft continuity, stale reads, simultaneous calls, cancellation and project isolation');
}
