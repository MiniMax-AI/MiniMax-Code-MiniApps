"""Mutation control for the 异常 guards.

Each mutation has to be caught, and caught *by the guard that owns the defect*. The probe prints
the exact names of the assertions that failed (`FAILED_NAMES\t[...]`), and a mutation is only
accepted when the named guard is among them — a substring match would let any nearby assertion
vouch for a mutation it knows nothing about, which is how a whole batch of these looked green
while testing nothing.

index.html is read and written as bytes and only the mutated substring is replaced, so line
endings are never touched — it is LF, and a blanket read_text/write_text round trip would
rewrite it to CRLF and trip CSS regexes that have nothing to do with this filter.
"""
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
PROBE = HERE / "verify-anomaly.mjs"
WATCHED = ROOT / "miniapp" / "client" / "index.html"

# The live-turn exclusion, kept as one constant because three mutations strip different halves
# of it and they must not drift apart.
NO_REPLY = "            return !!turn && turn.closed === false && turn !== ctx.liveTurn;"

CASES = [
    # --- the rule predicates: each is one comparison, and each one is the whole rule ---
    # The count on real data is unchanged by this one — every failing row in this session
    # carries a boolean — so the guard that owns it is the one that pins true-vs-truthy.
    ("a failure read as any truthy isError", 'the string "true" is not a failure either',
     "            return !!record && record.isError === true;",
     "            return !!record && !!record.isError;"),
    ("compaction widened to swallow 系统 rows too", "compaction count matches the payload",
     "            return !!record && record.kind === 'compaction';",
     "            return !!record && (record.kind === 'compaction' || record.kind === 'system');"),
    ("the live turn no longer excluded from 无答复", "the turn still running is not an anomaly",
     NO_REPLY, "            return !!turn && turn.closed === false;"),
    ("无答复 flipped to the turns that did answer", "a turn that never answered, seen from inside it",
     NO_REPLY, "            return !!turn && turn.closed === true && turn !== ctx.liveTurn;"),
    # NOTE: nulling the page's own `liveTurn` is deliberately NOT a case here. verify-anomaly.mjs
    # re-derives the live turn itself (`const liveTurn = payload.turns[payload.turns.length - 1]`)
    # instead of reading the page's function, so that mutation is invisible to every assertion in
    # the file -- it was tried, and the probe passed. Keeping the case would mean shipping a
    # mutation known to be unobservable, which is worse than naming the gap: the page's liveTurn
    # has no guard of its own until the harness stops re-deriving it.
    ("the turn head reads record-scoped rules as turn-scoped",
     "a rule that is record-scoped never tags a turn",
     "          if (rule.turn && rule.turn(turn, ctx)) out.push(rule.id);",
     "          if (rule.record || rule.turn(turn, ctx)) out.push(rule.id);"),

    # --- the filter's off state ---
    # Off has to mean "let everything through". Reading it as "match nothing" empties the
    # ledger the moment the filter is switched off, which looks like data loss, not a filter.
    ("off read as match-nothing", "the filter off lets a clean record through",
     "        if (!enabled || !enabled.length) return true;",
     "        if (!enabled) return true;"),
    ("the filter admits everything, ticked or not", "all rules on drops the clean record",
     "          if (enabled.indexOf(hits[i]) >= 0) return true;\n        }\n        return false;",
     "          if (enabled.indexOf(hits[i]) >= 0) return true;\n        }\n        return true;"),
    ("the enabled-rule test inverted, so one rule keeps what it should drop",
     "one rule on keeps only that rule",
     "          if (enabled.indexOf(hits[i]) >= 0) return true;",
     "          if (enabled.indexOf(hits[i]) < 0) return true;"),

    # --- the base filter: one predicate, walked by the ledger and nothing else ---
    # anomalyCounts used to walk this too, so a button could promise 246 while the list showed
    # 12. That walk is gone — 异常 mode ignores this axis — and what replaces the old assertion
    # is that the ledger still filters when no rule is ticked. This mutation keeps that true
    # case honest: if passesBaseFilter stopped applying the query, the list would stop being
    # filtered at all and the exclusivity check above it would pass for the wrong reason.
    ("the base filter stops applying the query",
     "and once the server has answered, the search narrows the list",
     "        if (state.query && !matchesQuery(record, state.query, state.searchHits)) return false;",
     "        if (false && state.query) return false;"),
    # Dropping the range from passesBaseFilter is deliberately NOT here: that guard lives in
    # verify-time-range.mjs, and a case listed against a probe that does not own it would be
    # reported as "not caught" while the real owner sat unmutated. It is in mutate-time-range.py.
    ("any counts rule hits instead of records, so a row trips two rules is counted twice",
     "the union count matches the payload",
     "          any += 1;", "          any += hits.length;"),
    # This one attacks the call site rather than the function, so it belongs to the guard that owns
# the call site: repointed rather than dropped, because dropping it would leave the render wiring
# with no mutation at all.
("the buttons read counts from somewhere else entirely",
     "the mode is settled before anything reads a count",
     "        var anomaly = anomalyCounts();\n        syncAnomalyMode(anomaly);\n        syncAnomalyButtons(anomaly);",
     "        var anomaly = anomalyCounts();\n        syncAnomalyMode(anomaly);\n        syncAnomalyButtons({ byRule: {}, unit: {}, any: 0, selected: 0 });"),

    # --- the strip is handed a bare record ---
    # 无答复 is a property of the turn, and the overview path only has the record, so the turn
    # has to come back out of the index. Losing that lookup makes the strip answer a different
    # question than the ledger directly above it.
    ("the strip cannot find the owning turn", "the strip and the ledger keep the same records",
     "        var owner = record ? turnById.get(record.turnId) : null;",
     "        var owner = null;"),
    # R2 is only worth anything if the second caller stays a way in rather than a second
    # opinion. Each of the three below puts one piece of the decision back where it does not
    # belong, and each is a shape that has actually happened on this page.
    ("the strip grows a predicate again", "and the strip keeps no predicate of its own to drift out of step",
     "        return recordVisible(record, owner || null, null);",
     "        return recordVisible(record, owner || null, null) && hasKind(record, state.kinds);"),
    # The brush is passed in so the strip can decline it. Reading it from state instead is a
    # one-word change that looks like tidying and hides the records the reader drags across.
    ("the brush read from state, so the strip hides what the reader drags over",
     "the brush is an argument, because the strip is what the brush is drawn on",
     "        if (selection && !recordInSelection(record, selection, overviewSpansById)) return false;",
     "        if (state.overviewSelection && !recordInSelection(record, state.overviewSelection, overviewSpansById)) return false;"),
    ("the ledger looks the turn up instead of taking the one it was handed",
     "and hands it the turn off the entry, not a lookup of its own",
     "          if (!recordVisible(entry.record, entry.turn, selection)) continue;",
     "          if (!recordVisible(entry.record, turnById.get(entry.record.turnId), selection)) continue;"),
    # These two used to attack a predicate inside each caller. There is only one caller of the
    # predicate now, so both moved onto it — the names kept, because each still breaks exactly
    # the thing it broke before: one makes the axis stop applying, the other makes the ledger
    # stop filtering at all.
    ("the one entry stopped applying 异常 at all",
     "and branches on the mode before the other axis, so strip and list agree",
     "          return passesAnomaly(record, { turn: turn || null, liveTurn: liveTurn() }, state.anomaly.rules);",
     "          return true;"),
    ("the ledger stopped filtering at all", "the ledger applies it",
     "          if (!recordVisible(entry.record, entry.turn, selection)) continue;",
     "          if (false) continue;"),

    # --- the state has to remember the ticks, or a poll re-renders the buttons from nothing ---
    ("the filter is not counted as a filter", "the filter counts as a filter",
     "          || state.anomaly.rules.length !== 0", "          || false"),
    ("清除筛选 leaves the filter on", "清除筛选 drops it too",
     "        state.anomaly = defaultAnomaly();\n        resetWindowMode();",
     "        resetWindowMode();"),
    # 清除筛选 used to sync the kind buttons itself; it now reaches them through
    # resetBaseFilters(), which owns them. So the line this mutation removes is the anomaly
    # sync, the one that stayed behind — the kind sync is still covered, by the reset's own
    # assertion that it updates the buttons.
    ("清除筛选 leaves the buttons showing the old state", "and re-syncs the buttons with it",
     "        syncAnomalyButtons(anomalyCounts());\n        render();",
     "        render();"),
    ("a poll stops refreshing the counts", "every poll re-syncs the buttons",
     "        syncAnomalyButtons(anomaly);\n        renderOverview();",
     "        renderOverview();"),
    # The defect this consolidation removed, rebuilt exactly as it was: 清除筛选 assigning the
    # base axes itself instead of calling the reset, and so no longer dropping the brush. It is
    # here rather than as a deletion because deleting `resetBaseFilters()` outright is a louder
    # change that several other rules notice — this is the quiet one, the shape the code drifts
    # back into on its own.
    ("清除筛选 goes back to assigning the base axes and forgets the brush",
     "清除筛选 drops the strip brush, which it used to leave standing",
     "      function clearFilters() {\n        resetBaseFilters();",
     "      function clearFilters() {\n        state.kinds = KIND_ORDER.slice();\n        state.query = '';"),

    # --- ticking, run rather than read ---
    ("ticking no longer resets the window", "and it resets the window like every other filter",
     "        if (next.length > 0) resetBaseFilters();\n        resetWindowMode();",
     "        if (next.length > 0) resetBaseFilters();"),
    # The guard it names moved into the 多选 block when 单选 became the default, which is where the
    # untick actually happens now: single mode replaces, so removal only exists with the checkbox on.
    ("unticking re-adds the rule it just removed", "多选: unticking removes only that one",
     "          if (next.length === state.anomaly.rules.length) next = next.concat([ruleId]);",
     "          if (next.length <= state.anomaly.rules.length) next = next.concat([ruleId]);"),
    ("全部异常 ticks the rule table itself instead of a copy",
     "全部异常 ticks a copy, not the table itself",
     "          next = state.anomaly.rules.length === ANOMALY_RULES.length ? [] : ANOMALY_RULE_IDS.slice();",
     "          next = state.anomaly.rules.length === ANOMALY_RULES.length ? [] : ANOMALY_RULE_IDS;"),

    # --- what the reader is shown ---
    ("the turn head stops naming the rule", "with the rule name, not a bare colour",
     "anomalyRuleLabel(turnFlags[flag])", "turnFlags[flag]"),
    ("the turn head drops the tag entirely", "the head tags a broken turn",
     "        var turnFlags = turnAnomalyRules(turn);", "        var turnFlags = [];"),
    # `ANOMALY_RULES[i]` also appears in turnAnomalyRules, so the anchor reaches into the next
    # line to say which of the two is being mutated.
    ("every button is built from the first rule", "one button per rule",
     "          var rule = ANOMALY_RULES[i];\n          var button = el('button', 'btn btn-quiet anomaly-btn');",
     "          var rule = ANOMALY_RULES[0];\n          var button = el('button', 'btn btn-quiet anomaly-btn');"),
    # A rule name written into the markup is a second list of names. The kind chips already had
    # this bug once: a rename left the button showing one word and announcing another.
    ("a rule name hardcoded into the markup", "no rule is hardcoded in the markup",
     '<div class="anomaly-quick" id="anomaly-controls" role="group" aria-labelledby="anomaly-label"></div>',
     '<div class="anomaly-quick" id="anomaly-controls" role="group" aria-labelledby="anomaly-label">工具失败</div>'),

    # --- the two axes are alternatives. Every one of these turns a mutually exclusive pair back
    # --- into a stack, which is the shape that produced "283 on the button, 1,494 in the list".
    # Anchored with the signature above it: `if (state.anomaly.rules.length > 0)` appears twice
    # — once in recordVisible(), once in applyFilterScope() — and the two mean nothing alike.
    ("the mode is read backwards, so the search stops filtering at all",
     "and once the server has answered, the search narrows the list",
     "      function recordVisible(record, turn, selection) {\n        if (state.anomaly.rules.length > 0) {",
     "      function recordVisible(record, turn, selection) {\n        if (state.anomaly.rules.length >= 0) {"),
    ("the two axes stacked instead of alternated",
     "and treats the two axes as alternatives, not a stack",
     "          return passesAnomaly(record, { turn: turn || null, liveTurn: liveTurn() }, state.anomaly.rules);\n        }\n        if (!hasKind",
     "          passesAnomaly(record, { turn: turn || null, liveTurn: liveTurn() }, state.anomaly.rules);\n        }\n        if (!hasKind"),
    ("the button count follows the search box again",
     "a search does not move the union count",
     "          var hits = recordAnomalyRules(entry.record, { turn: entry.turn, liveTurn: live });",
     "          var hits = state.query ? [] : recordAnomalyRules(entry.record, { turn: entry.turn, liveTurn: live });"),
    ("the strip branches after the other axis instead of before it",
     "and branches on the mode before the other axis, so strip and list agree",
     "        if (state.anomaly.rules.length > 0) {\n          return passesAnomaly(",
     "        if (false) {\n          return passesAnomaly("),

    # --- a turn rule is counted in turns. Counting its records is the original lie.
    ("a turn rule counted per record instead of per turn",
     "unanswered count matches the payload, counted in turns",
     "            var key = id + '#' + entry.turn.index;",
     "            var key = id + '#' + entry.record.id;"),
    ("every rule published in 条, whatever it is scoped to",
     "the turn rule publishes itself in 轮",
     "          unit[ANOMALY_RULES[i].id] = ANOMALY_RULES[i].turn ? '轮' : '条';",
     "          unit[ANOMALY_RULES[i].id] = '条';"),

    # --- there has to be a way out of the mode there is a way into.
    ("重置 is not built", "and one to put the row back to its default",
     "        none.id = 'anomaly-none';", "        none.id = 'anomaly-all-data';"),
    ("重置 ticks the whole set instead of clearing it",
     "重置 returns the row to its default",
     "        state.anomaly = defaultAnomaly();\n        if (dom.anomalyMulti) dom.anomalyMulti.checked = false;\n        resetWindowMode();",
     "        state.anomaly = { mode: 'single', rules: ANOMALY_RULE_IDS.slice(), last: null };\n        if (dom.anomalyMulti) dom.anomalyMulti.checked = false;\n        resetWindowMode();"),
    # 重置 has no count of its own: 「怎么多会留下多少」 is a question about a rule, and a control
    # that keeps whatever the row above says has no answer to it. Printing one anyway invites
    # adding it up against the numbers beside it.
    ("重置 given a count it cannot keep", "重置 advertises no count of its own",
     "        none.appendChild(el('span', 'anomaly-label', ANOMALY_NONE_LABEL));\n        dom.anomalyControls.appendChild(none);",
     "        none.appendChild(el('span', 'anomaly-label', ANOMALY_NONE_LABEL));\n        none.appendChild(el('span', 'anomaly-count', '0'));\n        dom.anomalyControls.appendChild(none);"),
    # In 异常 mode the row above filters nothing. Leaving it holding 「用户」 would be the page
    # showing a condition that is not in force — the same defect as a button whose number does
    # not match its list, one control over.
    ("ticking a rule no longer puts the row above back to default",
     "ticking a rule puts every type back",
     "        if (next.length > 0) resetBaseFilters();",
     "        if (next.length > 0 && false) resetBaseFilters();"),
    ("the reset forgets the search box",
     "and it drops the search answer with the needle, not just the needle",
     "        state.query = '';\n        state.searchHits = null;",
     "        state.query = '';"),
    # Distinct from the one above, and it was missing until a cross-check read the names rather
    # than the diffs: that mutation deletes `state.query`, not `dom.searchInput.value`. The box
    # is cleared by its own line, and with `dom.searchInput` nulled in the sandbox that line had
    # never executed under any assertion.
    ("the reset empties the state but leaves the search box showing the old text",
     "and empties the search box itself, not just the state behind it",
     "        clearTimeRange();\n        if (dom.searchInput) dom.searchInput.value = '';\n        syncKindButtons();",
     "        clearTimeRange();\n        syncKindButtons();"),
    ("the reset forgets the overview brush", "and drops the overview brush",
     "        dropOverviewSelection();\n        clearTimeRange();",
     "        clearTimeRange();"),
    # Setting state.kinds without syncKindButtons() is how the axis ends up drawing a condition
    # the table is not filtered by, which is the whole reason the reset exists.
    ("the reset sets the state but never the buttons",
     "the reset updates the buttons, or the axis would show a condition that is not in force",
     "        syncKindButtons();\n      }\n\n      /**\n       * Keeps the page honest",
     "      }\n\n      /**\n       * Keeps the page honest"),
    ("the inactive axis is dimmed but still takes clicks",
     "the inactive axis is made inert, not merely dimmed",
     "        for (var i = 0; i < scopes.length; i += 1) scopes[i].inert = on;",
     "        for (var i = 0; i < scopes.length; i += 1) scopes[i].inert = false;"),
    ("the 异常 axis moved back out from under the type axis",
     "the 异常 axis comes after it",
     '        <div class="anomaly-bar" id="anomaly-bar">',
     '        <div class="anomaly-bar" id="anomaly-strip">'),

    # --- 多选: one checkbox, two ways to read the same buttons.
    # Before this the toggle stacked unconditionally, so every one of these is a way to end up
    # back there — silently, and with a selection the controls can no longer express.
    ("单选 stacks instead of replacing",
     "单选: ticking a second replaces the first instead of stacking",
     "          next = [ruleId];\n          state.anomaly.last = ruleId;",
     "          next = state.anomaly.rules.concat([ruleId]);\n          state.anomaly.last = ruleId;"),
    ("单选 cannot be turned off by pressing the rule that is on",
     "单选: pressing the rule already on turns it off again",
     "        } else if (state.anomaly.rules.length === 1 && state.anomaly.rules[0] === ruleId) {\n          next = [];",
     "        } else if (false) {\n          next = [];"),
    ("多选 stacks without removing anything",
     "多选: unticking removes only that one",
     "          next = state.anomaly.rules.filter(function (id) {\n            return id !== ruleId;\n          });\n          if (next.length === state.anomaly.rules.length) next = next.concat([ruleId]);",
     "          next = state.anomaly.rules.concat([ruleId]);"),
    ("the union branch is never taken, so 多选 is only a label",
     "多选: ticking a second stacks instead of replacing",
     "        } else if (state.anomaly.mode === 'multi') {",
     "        } else if (false) {"),
    # Which rule survives is a decision, so it is asserted. Table order is the wrong answer to
    # "which one was I looking at": it silently moves the reader to a filter they did not pick.
    ("turning 多选 off keeps the first rule in table order instead of the last one ticked",
     "turning 多选 off keeps the rule ticked last, not the first in table order",
     "          state.anomaly.rules = [last && state.anomaly.rules.indexOf(last) >= 0\n            ? last\n            : state.anomaly.rules[0]];",
     "          state.anomaly.rules = [state.anomaly.rules[0]];"),
    # The collapse is gated on turning 多选 *off*. Ungated, 全部异常 — which is legal in 单选 —
    # would lose three of its four rules the moment the reader asked for the union.
    ("turning 多选 on also collapses the selection",
     "turning 多选 on changes the mode and nothing else",
     "        if (!checked && state.anomaly.rules.length > 1) {",
     "        if (state.anomaly.rules.length > 1) {"),
    ("重置 leaves 多选 on", "and 多选 goes off with it",
     "        state.anomaly = defaultAnomaly();\n        if (dom.anomalyMulti) dom.anomalyMulti.checked = false;\n        resetWindowMode();",
     "        state.anomaly = defaultAnomaly();\n        state.anomaly.mode = 'multi';\n        if (dom.anomalyMulti) dom.anomalyMulti.checked = false;\n        resetWindowMode();"),
    ("重置 clears the state but leaves the box drawn as ticked",
     "and the checkbox stops reading as on",
     "        state.anomaly = defaultAnomaly();\n        if (dom.anomalyMulti) dom.anomalyMulti.checked = false;\n        resetWindowMode();",
     "        state.anomaly = defaultAnomaly();\n        resetWindowMode();"),
    # The checkbox sits outside `#anomaly-controls` precisely so it cannot be swept up by the
    # inert-marking that switches the other axis off.
    ("the 多选 checkbox marked as a filter control, so it goes inert with the rest",
     "and it is never marked as a filter control, so it cannot be made inert",
     '<label class="anomaly-multi" for="anomaly-multi">',
     '<label class="anomaly-multi" data-filter-scope for="anomaly-multi">'),
    ("the checkbox is never re-drawn from state, so a poll can strand it ticked",
     "every poll re-draws the checkbox from state, not from where the reader left it",
     "        if (dom.anomalyMulti) dom.anomalyMulti.checked = state.anomaly.mode === 'multi';",
     ""),
    ("多选 opens on, so the documented default is a union",
     "多选 opens off, because 单选 is the documented default",
     "          mode: 'single',", "          mode: 'multi',"),
    ("the checkbox bound to click, which a keyboard toggle never fires",
     "the checkbox is bound to the mode handler",
     "        dom.anomalyMulti.addEventListener('change', function () {",
     "        dom.anomalyMulti.addEventListener('click', function () {"),

    # --- 合计: the number the note publishes has to be the number under the buttons.
    # The defect this replaces printed 合计见「全部异常」, which is the union of all four rules and
    # therefore described a different selection than the one on screen.
    ("the partial union is counted as the whole table",
     "a partial union is the length of the list behind it",
     "            if (sel.indexOf(hits[s]) >= 0) {\n              selected += 1;\n              break;\n            }",
     "            if (sel.length === 0 || sel.indexOf(hits[s]) >= 0) {\n              selected += 1;\n            }"),
    # Dropping the `break` turns the union into a count of rule-hits: correct until two rules
    # overlap on one record, which is exactly the case the note exists to account for. A mutation
    # that only differs when there is overlap is worth more than one that is always different.
    ("a record tripping two rules is counted twice in the union",
     "a partial union is the length of the list behind it",
     "            if (sel.indexOf(hits[s]) >= 0) {\n              selected += 1;\n              break;\n            }",
     "            if (sel.indexOf(hits[s]) >= 0) {\n              selected += 1;\n            }"),
    ("the note publishes 全部异常's number for a partial selection",
     "the note publishes the total for the rules that are ticked",
     "              ? ' · 已叠加 ' + formatInt(n) + ' 条规则 · 合计 ' + formatInt(counts.selected) + ' 条'",
     "              ? ' · 已叠加 ' + formatInt(n) + ' 条规则 · 合计 ' + formatInt(counts.any) + ' 条'"),
    # The defect, stated as the shape that would reintroduce it. A partial selection is not
    # 全部异常, so a total that is not the partial selection's own is the failure however it is
    # worded — which is why the assertion parses the number back out instead of matching a phrase.
    ("the note goes back to pointing at 全部异常",
     "and it is a number, not a pointer somewhere else",
     "              ? ' · 已叠加 ' + formatInt(n) + ' 条规则 · 合计 ' + formatInt(counts.selected) + ' 条'",
     "              ? ' · 已叠加 ' + formatInt(n) + ' 条规则，合计见「全部异常」'"),
    # 叠加 is 多选's word. In 单选 the only way to get here is 全部异常, which the reader did not
    # stack — and the note was telling a reader who had not turned 多选 on that they had.
    ("the note calls 全部异常 a stack even when 多选 is off",
     "单选 does not claim a stack the reader never built",
     "            : ' · 全部 ' + formatInt(n) + ' 条规则同时生效 · 合计 ' + formatInt(counts.selected) + ' 条')",
     "            : ' · 已叠加 ' + formatInt(n) + ' 条规则 · 合计 ' + formatInt(counts.selected) + ' 条')"),
    # 重置 describes the whole row, and 多选 is part of that row. Leaving it out made the button
    # claim the reader was already at the default while the mode was not, and it is the only
    # control that puts the mode back.
    ("重置 claims default while 多选 is on",
     "重置 is pressed only when both the rules and the mode are at their default",
     "            on = state.anomaly.rules.length === 0 && state.anomaly.mode !== 'multi';",
     "            on = state.anomaly.rules.length === 0;"),
    # Two walks of a session that is still growing can hand the note and the buttons different
    # numbers. This is the guard that keeps them on one read.
    ("the note walks the session a second time",
     "and the note and the buttons are handed the same walk, not two of them",
     "        var anomaly = anomalyCounts();\n        syncAnomalyMode(anomaly);",
     "        var anomaly = anomalyCounts();\n        syncAnomalyMode(anomalyCounts());"),
    ("the buttons walk the session again instead of taking the snapshot",
     "the count comes from the pass render() took, not a second walk",
     "      function syncAnomalyButtons(counts) {\n        if (!dom.anomalyControls) return;",
     "      function syncAnomalyButtons(counts) {\n        if (!dom.anomalyControls) return;\n        counts = anomalyCounts();"),

    # --- 空答复: a reply the runtime finished and then delivered nothing into.
    # Every other rule tests a field that was there. This one tests an absence, so most of the
    # ways to get it wrong are over-matching rather than under-matching.
    #
    # The absence it tests is `hasText === false` and not `isNil(record.text)` any more: the body
    # does not travel with the row, so the rule reads the server's verdict on it. The shape of the
    # trap is unchanged — a strict `=== false` is what keeps a record from an older payload, which
    # has neither flag nor body, from being called an anomaly.
    ("an empty answer rule that ignores the body", "a reply that said something is not",
     "            return !!record && record.kind === 'reply' && record.hasText === false;",
     "            return !!record && record.kind === 'reply';"),
    ("the no-body test inverted, so every spoken reply becomes an anomaly",
     "a reply with no body is an empty answer",
     "            return !!record && record.kind === 'reply' && record.hasText === false;",
     "            return !!record && record.kind === 'reply' && record.hasText === true;"),
    # The expected name is the checkpoint assertion, not "a normal row is not an anomaly". A row
    # with a body cannot fire this rule whichever way the KIND test is written, so that assertion
    # has nothing to say about an inversion here; the record that does is a non-reply WITHOUT a
    # body, and the fixture that owns "a non-reply is not an empty answer" is the checkpoint one.
    ("the kind test inverted, so every non-reply is an empty answer",
     "a checkpoint is not also an empty answer",
     "            return !!record && record.kind === 'reply' && record.hasText === false;",
     "            return !!record && record.kind !== 'reply' && record.hasText === false;"),
    # Dropping the body and reading truncation instead hits the plain no-body case first, on a
    # record that carries no truncation flag at all. That assertion is the one that owns it.
    ("no-body judged by truncation instead of by absence", "a reply with no body is an empty answer",
     "            return !!record && record.kind === 'reply' && record.hasText === false;",
     "            return !!record && record.kind === 'reply' && record.textTruncated === false;"),
    ("a checkpoint counted twice, once as a checkpoint and once as an empty answer",
     "a checkpoint is not also an empty answer",
     "            return !!record && record.kind === 'reply' && record.hasText === false;",
     "            return !!record && record.hasText === false;"),
    ("the empty-answer rule never fires", "empty answer count matches the payload",
     "            return !!record && record.kind === 'reply' && record.hasText === false;",
     "            return false;"),

    # --- and the row, because a filter that shows these without marking them shows nothing
    ("the empty-answer marker removed from the row", "an empty reply is marked on its row",
     "        var silent = record.kind === 'reply' && record.hasText === false;",
     "        var silent = false;"),
    ("the row's marker branch dropped, leaving the duration cell instead",
     "and it reuses the duration cell instead of adding a column",
     "        } else if (silent) {\n"
     "          // The name comes from the rule table, not from a second copy written here. A label\n"
     "          // that exists in two places is the drift this page already paid for once on the kind\n"
     "          // chips: rename the rule and the row keeps announcing the old word.\n"
     "          row.appendChild(pill(anomalyRuleLabel('silent'), 'error'));\n"
     "          row.title = anomalyRuleLabel('silent') + ' · 模型正常结束，但没有返回任何内容';\n"
     "        } else {",
     "        } else {"),
    ("the row's marker written from a literal label instead of the rule table",
     "the row never paints a rule name literally — silent",
     "          row.appendChild(pill(anomalyRuleLabel('silent'), 'error'));",
     "          row.appendChild(pill('空答复', 'error'));"),
    ("the marker branch made unreachable", "and it reuses the duration cell instead of adding a column",
     "        } else if (silent) {", "        } else if (false) {"),
]


def run_probe():
    proc = subprocess.run(
        ["node", str(PROBE)], cwd=str(ROOT), capture_output=True, text=True,
        encoding="utf-8", errors="replace",
    )
    fired = []
    saw_report = False
    for line in proc.stdout.splitlines():
        if line.startswith("FAILED_NAMES\t"):
            fired = json.loads(line.split("\t", 1)[1])
            saw_report = True
    # A probe that throws never reaches its report. Treating that as a catch would let any
    # mutation that breaks the script outright — rather than the rule it was aimed at — pass
    # for evidence, which is the whole failure mode this runner exists to prevent.
    return proc.returncode == 0, (fired if saw_report else None), proc.stdout + proc.stderr


def main():
    original = WATCHED.read_bytes()
    ok, fired, output = run_probe()
    if not ok or fired:
        print("baseline verify-anomaly.mjs did not pass; refusing to run mutations")
        print(output)
        return 1

    failures = []
    for name, expected, old, new in CASES:
        text = original.decode("utf-8")
        if text.count(old) != 1:
            failures.append(f"{name}: anchor matched {text.count(old)} times, expected exactly 1")
            continue

        WATCHED.write_bytes(text.replace(old, new, 1).encode("utf-8"))
        try:
            passed, fired, _ = run_probe()
        finally:
            WATCHED.write_bytes(original)

        if fired is None:
            failures.append(f"{name}: CRASHED — the probe stopped before reporting; that is not a catch")
            continue
        if passed:
            failures.append(f"{name}: NOT CAUGHT — probe still passed")
            continue
        if expected not in fired:
            failures.append(f"{name}: caught by {fired}, expected {expected!r}")
            continue
        print(f"  caught by {expected}: {name}")

    # Two different questions, and this used to answer only one of them.
    #
    # `read_bytes() != original` asks "did this run leave the file where it found it". That is a
    # real question and the `finally` above already guarantees the answer, which is exactly why the
    # question is worthless on its own: measured on 2026-10-13, a file that was *already* modified
    # before the run came back with `index.html restored byte-for-byte`, 75/75 caught, and exit 0,
    # while the file was still modified. Once a mutation has leaked, `original` is the leaked text,
    # so the comparison is dirty == dirty and can never fail again. That is how a dirty file
    # survived every later run while every later run said it was clean.
    #
    # So the check that does the work is the one that is not relative to our own starting point:
    # after the last mutation is restored, ask the guard suite whether the shipped file still
    # satisfies the rules. A leaked mutation breaks one of them by construction — that is the whole
    # premise of this file — so this is the check that notices.
    if WATCHED.read_bytes() != original:
        failures.append("index.html differs from where this run started")
    else:
        print("index.html unchanged from where this run started")

    final_ok, final_fired, final_output = run_probe()
    if not final_ok:
        failures.append(
            "the guard suite is RED after every mutation was restored — index.html was left "
            "modified:\n" + final_output.strip()
        )
    elif final_fired:
        failures.append(
            "the guard suite still fails after every mutation was restored: %r" % (final_fired,)
        )
    else:
        print("guard suite green again on the restored file (this is the one that can fail)")

    if failures:
        print("\nFAILURES:")
        for line in failures:
            print(" - " + line)
        return 1

    print(f"\nOK  ({len(CASES)} mutations, each caught by the guard that owns the defect)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
