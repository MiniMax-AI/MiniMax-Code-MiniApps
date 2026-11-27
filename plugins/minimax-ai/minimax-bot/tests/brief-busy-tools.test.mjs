import assert from 'node:assert/strict';
import { test } from 'node:test';
import strings from '../miniapp/node/strings.mjs';

// A Bot that is told "busy Bots queue the work" and nothing else answers the way it answered
// in MiniMax开放平台用户交流群: 「这个 Bot 正在忙别的任务，已排队，轮到后自动发送」 — it cannot
// say what the other Bot is doing, and the user has no way to stop it. The tools were always
// there (get_tasks / cancel_tasks / list_schedules / delete_schedule); the brief never said to
// use them when something is busy, and it forbade reading the ids out without saying they are
// still for the tools.

for (const lang of ['zh', 'en']) {
  test(`the brief tells a Bot to look before it says "queued" (${lang})`, () => {
    const tasks = strings[lang]['brief.tool.tasks'];
    const message = strings[lang]['brief.tool.message'];
    for (const text of [tasks, message]) {
      assert.match(text, /get_tasks/u, 'the Bot is told to look the busy Bot up');
    }
    assert.match(tasks, /cancel_tasks/u, 'the Bot is told how to stop it');
    assert.match(message, /cancel_tasks/u, 'the Bot is told how to stop it from message_bot too');
  });

  test(`the ids stay for the tools, and what they find is told to the user (${lang})`, () => {
    const tasks = strings[lang]['brief.tool.tasks'];
    // The ids are still not read out to the user...
    assert.match(tasks, lang === 'zh' ? /不要向用户暴露任务编号/u : /Do not expose task IDs/u);
    // ...but the answer has to say that the ids are for the tools and that the findings are not.
    assert.match(tasks, lang === 'zh' ? /编号是给工具用的/u : /The ids are for the tools/u);
    assert.match(tasks, lang === 'zh' ? /查到的东西要讲给用户听/u : /do tell the user what the query found/u);
  });

  test(`a question about a schedule is answered from list_schedules (${lang})`, () => {
    const schedule = strings[lang]['brief.tool.schedule'];
    assert.match(schedule, /list_schedules/u);
    assert.match(schedule, /delete_schedule/u);
    // And the limit of that list is stated: something the Host runs elsewhere is not in it.
    assert.match(schedule, lang === 'zh' ? /宿主别处的定时任务不在这里/u : /a schedule the Host runs elsewhere is neither here/u);
  });

  test(`both languages say the same thing about a busy Bot (${lang})`, () => {
    for (const key of ['brief.tool.tasks', 'brief.tool.message', 'mcp.t.message_bot', 'brief.tool.schedule']) {
      assert.equal(typeof strings[lang][key], 'string', `${key} missing in ${lang}`);
      assert.ok(strings[lang][key].length > 0, `${key} empty in ${lang}`);
      assert.ok(!strings[lang][key].includes('undefined'), `${key} has an empty placeholder in ${lang}`);
    }
  });
}
