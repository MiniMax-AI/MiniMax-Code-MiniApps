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
     "but with no rule ticked the search is still a filter for the list",
     "        if (state.query && !matchesQuery(record, state.query)) return false;",
     "        if (false && state.query) return false;"),
    # Dropping the range from passesBaseFilter is deliberately NOT here: that guard lives in
    # verify-time-range.mjs, and a case listed against a probe that does not own it would be
    # reported as "not caught" while the real owner sat unmutated. It is in mutate-time-range.py.
    ("any counts rule hits instead of records, so a row trips two rules is counted twice",
     "the union count matches the payload",
     "          any += 1;", "          any += hits.length;"),
    ("the buttons read counts from somewhere else entirely",
     "the count comes from the shared pass, not a second walk",
     "        var counts = anomalyCounts();", "        var counts = { byRule: {}, any: 0 };"),

    # --- the strip is handed a bare record ---
    # 无答复 is a property of the turn, and the overview path only has the record, so the turn
    # has to come back out of the index. Losing that lookup makes the strip answer a different
    # question than the ledger directly above it.
    ("the strip cannot find the owning turn", "the strip and the ledger keep the same records",
     "        var owner = record ? turnById.get(record.turnId) : null;",
     "        var owner = null;"),
    ("the strip stopped applying 异常 at all", "the strip applies it",
     "          return passesAnomaly(record, { turn: owner || null, liveTurn: liveTurn() }, state.anomalyRules);",
     "          return true;"),
    ("the ledger stopped applying 异常", "the ledger applies it",
     "            if (!passesAnomaly(entry.record, anomalyContext(entry), state.anomalyRules)) continue;\n", ""),

    # --- the state has to remember the ticks, or a poll re-renders the buttons from nothing ---
    ("the filter is not counted as a filter", "the filter counts as a filter",
     "          || state.anomalyRules.length !== 0", "          || false"),
    ("清除筛选 leaves the filter on", "清除筛选 drops it too",
     "        state.anomalyRules = [];\n        clearTimeRange();",
     "        clearTimeRange();"),
    ("清除筛选 leaves the buttons showing the old state", "and re-syncs the buttons with it",
     "        syncKindButtons();\n        syncAnomalyButtons();\n        render();",
     "        syncKindButtons();\n        render();"),
    ("a poll stops refreshing the counts", "every poll re-syncs the buttons",
     "        syncAnomalyButtons();\n        renderOverview();",
     "        renderOverview();"),

    # --- ticking, run rather than read ---
    ("ticking no longer resets the window", "and it resets the window like every other filter",
     "        if (next.length > 0) resetBaseFilters();\n        resetWindowMode();",
     "        if (next.length > 0) resetBaseFilters();"),
    ("unticking re-adds the rule it just removed", "unticking removes only that one",
     "          if (next.length === state.anomalyRules.length) next = next.concat([ruleId]);",
     "          if (next.length <= state.anomalyRules.length) next = next.concat([ruleId]);"),
    ("全部异常 ticks the rule table itself instead of a copy",
     "全部异常 ticks a copy, not the table itself",
     "          next = state.anomalyRules.length === ANOMALY_RULES.length ? [] : ANOMALY_RULE_IDS.slice();",
     "          next = state.anomalyRules.length === ANOMALY_RULES.length ? [] : ANOMALY_RULE_IDS;"),

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
    ("the mode is read backwards, so the search stops filtering at all",
     "but with no rule ticked the search is still a filter for the list",
     "        var anomalyMode = state.anomalyRules.length > 0;",
     "        var anomalyMode = state.anomalyRules.length >= 0;"),
    ("the two axes stacked instead of alternated",
     "and treats the two axes as alternatives, not a stack",
     "          } else if (!passesBaseFilter(entry.record, selection)) {",
     "          }\n          if (!passesBaseFilter(entry.record, selection)) {"),
    ("the button count follows the search box again",
     "a search does not move the union count",
     "          var hits = recordAnomalyRules(entry.record, { turn: entry.turn, liveTurn: live });",
     "          var hits = state.query ? [] : recordAnomalyRules(entry.record, { turn: entry.turn, liveTurn: live });"),
    ("the strip branches after the other axis instead of before it",
     "and branches on the mode before the other axis, so strip and list agree",
     "        if (state.anomalyRules.length > 0) {\n          return passesAnomaly(",
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
     "        if (state.anomalyRules.length === 0) return;\n        state.anomalyRules = [];",
     "        if (state.anomalyRules.length === 0) return;\n        state.anomalyRules = ANOMALY_RULE_IDS.slice();"),
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
    ("the reset forgets the search box", "and drops the search",
     "        state.query = '';\n        state.overviewSelection = null;",
     "        state.overviewSelection = null;"),
    ("the reset forgets the overview brush", "and drops the overview brush",
     "        state.overviewSelection = null;\n        clearTimeRange();",
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

    # --- 空答复: a reply the runtime finished and then delivered nothing into.
    # Every other rule tests a field that was there. This one tests an absence, so most of the
    # ways to get it wrong are over-matching rather than under-matching.
    ("an empty answer rule that ignores the body", "a reply that said something is not",
     "            return !!record && record.kind === 'reply' && isNil(record.text);",
     "            return !!record && record.kind === 'reply';"),
    ("the no-body test inverted, so every spoken reply becomes an anomaly",
     "a reply with no body is an empty answer",
     "            return !!record && record.kind === 'reply' && isNil(record.text);",
     "            return !!record && record.kind === 'reply' && !isNil(record.text);"),
    ("the kind test inverted, so every non-reply is an empty answer",
     "a normal row is not an anomaly",
     "            return !!record && record.kind === 'reply' && isNil(record.text);",
     "            return !!record && record.kind !== 'reply' && isNil(record.text);"),
    # Dropping the body and reading truncation instead hits the plain no-body case first, on a
    # record that carries no truncation flag at all. That assertion is the one that owns it.
    ("no-body judged by truncation instead of by absence", "a reply with no body is an empty answer",
     "            return !!record && record.kind === 'reply' && isNil(record.text);",
     "            return !!record && record.kind === 'reply' && record.textTruncated === false;"),
    ("a checkpoint counted twice, once as a checkpoint and once as an empty answer",
     "a checkpoint is not also an empty answer",
     "            return !!record && record.kind === 'reply' && isNil(record.text);",
     "            return !!record && isNil(record.text);"),
    ("the empty-answer rule never fires", "empty answer count matches the payload",
     "            return !!record && record.kind === 'reply' && isNil(record.text);",
     "            return false;"),

    # --- and the row, because a filter that shows these without marking them shows nothing
    ("the empty-answer marker removed from the row", "an empty reply is marked on its row",
     "        var silent = record.kind === 'reply' && isNil(record.text);",
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

    if WATCHED.read_bytes() != original:
        failures.append("index.html was not restored byte-for-byte")
    else:
        print("index.html restored byte-for-byte")

    if failures:
        print("\nFAILURES:")
        for line in failures:
            print(" - " + line)
        return 1

    print(f"\nOK  ({len(CASES)} mutations, each caught by the guard that owns the defect)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
