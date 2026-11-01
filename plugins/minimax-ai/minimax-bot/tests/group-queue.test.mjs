// @ts-check
// Who speaks first on a new group message, read the way old groups still write it.
//
// The point of this file: a group's queue is built from its member list, and only from it.
// Groups created before 0.7.8 can hold an adminId that is not on memberIds (the state was
// written before the member list carried the admin); queueing that admin hands driveGroup a
// speaker it silently skips, so with the reply mode "admin" every un-@'d message went quiet
// (issues #63, #65). These assertions pin the rule: only a member queues, an off-list admin
// falls back to the first member, and an @mention still beats every reply mode.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Engine } from '../miniapp/node/engine.mjs';

const bots = [
  { id: 'chief', name: 'Chief' },
  { id: 'alice', name: 'Alice' },
  { id: 'bob', name: 'Bob' },
];

/** A bare engine: groupQueue is a pure selector, it only reads this.mentionsIn and this.store. */
function engine() {
  const bare = /** @type {any} */ (Object.create(Engine.prototype));
  bare.store = { getBot: (id) => bots.find((bot) => bot.id === id) };
  return bare;
}

function group(overrides = {}) {
  return { adminId: 'chief', memberIds: ['chief', 'alice', 'bob'], replyMode: 'admin', ...overrides };
}

test('an admin on the member list opens the queue, the way it always did', () => {
  const app = engine();
  assert.deepEqual(app.groupQueue(group(), 'any message'), ['chief']);
  // "all" keeps the admin first and the rest in member order.
  assert.deepEqual(app.groupQueue(group({ replyMode: 'all' }), 'any message'), ['chief', 'alice', 'bob']);
});

test('an admin off the member list falls back to the first member', () => {
  const app = engine();
  // The stored state of an old group: the admin is gone from the members it rules.
  assert.deepEqual(app.groupQueue(group({ adminId: 'ghost' }), 'any message'), ['chief']);
  assert.deepEqual(app.groupQueue(group({ adminId: undefined }), 'any message'), ['chief']);
  // And in "all" the ghost admin is not queued at all — only members speak, in member order.
  assert.deepEqual(app.groupQueue(group({ adminId: 'ghost', replyMode: 'all' }), 'any message'), ['chief', 'alice', 'bob']);
});

test('a memberless group queues nobody', () => {
  const app = engine();
  assert.deepEqual(app.groupQueue(group({ memberIds: [] }), 'any message'), []);
  assert.deepEqual(app.groupQueue(group({ memberIds: [], replyMode: 'all' }), 'any message'), []);
});

test('an @mention still beats the reply mode', () => {
  const app = engine();
  assert.deepEqual(app.groupQueue(group(), '@alice what do you think?'), ['alice']);
  assert.deepEqual(app.groupQueue(group({ replyMode: 'all' }), '@bob please review'), ['bob']);
  // Several mentions keep their order, and an off-list admin mentioned by name is not a member
  // so mentionsIn never matches it in the first place.
  assert.deepEqual(app.groupQueue(group(), '@bob and @alice'), ['bob', 'alice']);
  assert.deepEqual(app.groupQueue(group({ adminId: 'ghost' }), 'no one addressed'), ['chief']);
});
