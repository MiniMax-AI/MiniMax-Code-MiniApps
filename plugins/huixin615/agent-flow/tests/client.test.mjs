import assert from 'node:assert/strict';
import { test } from 'node:test';

class Element {
  children = [];
  style = {};
  value = '';
  listeners = new Map();

  set textContent(value) { this.text = String(value); }
  get textContent() { return this.text ?? ''; }

  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
}

test('imported chats stay unselected until the user chooses one', async () => {
  const elements = new Map();
  globalThis.document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new Element());
      return elements.get(id);
    },
    createElement() { return new Element(); },
  };
  globalThis.window = {};
  await import('../miniapp/client/app.js');

  const older = 'a'.repeat(64);
  const newer = 'b'.repeat(64);
  const call = 'c'.repeat(64);
  const oldChild = 'd'.repeat(64);
  const newChild = 'e'.repeat(64);
  const row = (id, event, session, at, extra = {}) => ({
    schema: 'agent-flow-hook/v1', id, event, session, at,
    parentSession: null, turn: null, agent: null, toolUse: null, ...extra,
  });
  const select = elements.get('session-select');
  const files = elements.get('event-files');
  const importRows = async (rows) => {
    const contents = `${rows.map((value) => JSON.stringify(value)).join('\n')}\n`;
    files.files = [{ name: 'agent-flow-events.jsonl', size: contents.length, text: async () => contents }];
    await files.listeners.get('change')();
  };

  await importRows([
    row('old-session', 'SessionStart', older, 1000),
    row('old-task', 'PreToolUse', older, 1100, { toolUse: call, taskTitle: 'Old task' }),
    row('old-child-start', 'SubagentStart', oldChild, 1200, { agentType: 'explore' }),
    row('old-child-stop', 'SubagentStop', oldChild, 1500, { agentType: 'explore' }),
    row('new-session', 'SessionStart', newer, 2000),
    row('new-task', 'PreToolUse', newer, 2100, { toolUse: call, taskTitle: 'New task' }),
    row('new-child-start', 'SubagentStart', newChild, 2200, { agentType: 'explore' }),
    row('new-result', 'PostToolUse', newer, 2300, { toolUse: call, childSession: newChild, resultPresent: true }),
    row('new-child-stop', 'SubagentStop', newChild, 2500, { agentType: 'explore' }),
  ]);
  assert.equal(select.value, '');
  assert.equal(elements.get('total').textContent, '0');
  assert.match(elements.get('session-note').textContent, /无法识别当前聊天/);
  assert.match(elements.get('file-note').textContent, /已导入 agent-flow-events\.jsonl/);
  assert.equal(files.value, '');
  assert.equal(select.children.length, 3);
  assert.match(select.children[1].textContent, /\d{4}-\d{2}-\d{2}/);

  elements.get('latest-session').listeners.get('click')();
  assert.equal(select.value, newer);
  assert.equal(elements.get('total').textContent, '1');
  assert.equal(elements.get('linked').textContent, '1');
  assert.match(elements.get('session-note').textContent, /推断/);
  const visibleText = (element) => [element.textContent, ...element.children.map(visibleText)].join(' ');
  assert.match(visibleText(elements.get('children')), new RegExp(newChild.slice(0, 10)));
  assert.match(visibleText(elements.get('children')), /New task/);
  assert.match(visibleText(elements.get('flow')), new RegExp(newChild.slice(0, 10)));
  assert.doesNotMatch(visibleText(elements.get('children')), new RegExp(oldChild.slice(0, 10)));
  assert.doesNotMatch(visibleText(elements.get('observation')), /另有|全文件/);
  assert.equal(elements.get('observation-panel').hidden, true);

  select.value = older;
  select.listeners.get('change')();
  assert.equal(elements.get('total').textContent, '1');
  assert.equal(elements.get('linked').textContent, '0');
  assert.match(elements.get('session-note').textContent, /不一定是当前聊天/);
  assert.equal(elements.get('observation-panel').hidden, false);

  await importRows([
    row('new-session', 'SessionStart', newer, 2000),
    row('new-task', 'PreToolUse', newer, 2100, { toolUse: call, taskTitle: 'New task' }),
  ]);
  assert.equal(select.value, '');
  assert.equal(elements.get('total').textContent, '0');
});
