"""Mutation control for verify-anomaly-model.mjs.

The guard's own header claimed this file existed while it did not, which is the same defect
the guard is about: a claim in the shipped tree that nothing was checking. Each rule below is
broken in the shipped file and the guard has to report it *by name* — a substring match would
let a nearby assertion vouch for a rule it knows nothing about.

index.html is read and written as bytes and only the mutated substring is replaced, so line
endings are never touched: it is LF, and a blanket read_text/write_text round trip would
rewrite it to CRLF.
"""
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
PROBE = HERE / "verify-anomaly-model.mjs"
WATCHED = ROOT / "miniapp" / "client" / "index.html"

DECL = "        anomaly: {"
FACTORY = """      function defaultAnomaly() {
        return { mode: 'single', rules: [], last: null };
      }"""

CASES = [
    # --- the three old names have to be gone, not aliased ---
    # Written with the `state.` prefix the guard counts on. A bare `anomalyRules: []` added to
    # the declaration would not be a second answer to anything — it would be a dead key.
    ("the old anomalyRules field comes back as a second answer",
     "the old field state.anomalyRules is gone",
     "        state.anomaly.rules = next;",
     "        state.anomaly.rules = next;\n        state.anomalyRules = next;"),
    ("the old multiAnomaly flag is back beside the model",
     "the old field state.multiAnomaly is gone",
     "        state.anomaly.rules = next;",
     "        state.anomaly.rules = next;\n        state.multiAnomaly = state.anomaly.mode === 'multi';"),
    ("the old anomalyLast field is back beside the model",
     "the old field state.anomalyLast is gone",
     "        state.anomaly.rules = next;",
     "        state.anomaly.rules = next;\n        state.anomalyLast = next.length ? null : state.anomaly.last;"),

    # --- the object has to declare all three at once ---
    ("the axis is renamed out from under the guard",
     "state declares anomaly as one object",
     DECL, "        anomalyAxis: {"),
    ("the rule list is renamed, so the model loses its key",
     "the anomaly object declares rules",
     "          rules: [],", "          rulesList: [],"),
    ("the last-ticked rule is renamed, so the model loses its key",
     "the anomaly object declares last",
     "          last: null", "          lastRule: null"),
    # Not a rename: the axis opening in 多选 makes every other button on the row mean
    # something different from what pressing it looks like, and 单选 is the documented default.
    ("the axis opens in 多选",
     "the anomaly axis opens in single mode",
     "          mode: 'single',", "          mode: 'multi',"),

    # --- one writer per key, same as before ---
    # Two whole-object assignments became one. A third is exactly the duplication this
    # removed, coming back as "just one more place to reset it".
    ("a third place rebuilds the whole anomaly model",
     "the whole anomaly model is assigned in exactly 2 places",
     "        state.anomaly = defaultAnomaly();\n        if (dom.anomalyMulti) dom.anomalyMulti.checked = false;\n        resetWindowMode();",
     "        state.anomaly = defaultAnomaly();\n        if (dom.anomalyMulti) dom.anomalyMulti.checked = false;\n        render();\n        state.anomaly = defaultAnomaly();\n        resetWindowMode();"),
    ("a fourth writer for the ticked rules",
     "state.anomaly.rules has exactly 2 writers",
     "        state.anomaly.rules = next;", "        state.anomaly.rules = next;\n        state.anomaly.rules = next;"),
    # Untick in 单选 leaves `last` pointing at the rule the reader just switched off, so turning
    # 多选 off afterwards has nothing trustworthy to fall back to. This is the one of the five
    # writes whose absence is invisible from the button state alone.
    ("one of the five last-ticked writes is dropped",
     "state.anomaly.last has exactly 5 writers",
     "          next = [];\n          state.anomaly.last = null;",
     "          next = [];"),
    # The mode has exactly one writer because the checkbox is the only thing that turns it.
    # Removing it outright leaves the mode a write-once value 重置 cannot put back.
    ("the mode stops being written when the checkbox moves it",
     "state.anomaly.mode has exactly 1 writer",
     "        state.anomaly.mode = checked ? 'multi' : 'single';\n", ""),

    # --- the factory hands back a fresh object ---
    # A shared constant is the two-writers defect wearing a different hat: ticking a rule
    # writes through to whatever the other holder is still holding.
    ("the default is a shared constant both resets hand out",
     "defaultAnomaly() returns a fresh literal rather than a shared constant",
     FACTORY,
     "      var ANOMALY_DEFAULT = { mode: 'single', rules: [], last: null };\n"
     "      function defaultAnomaly() {\n        return ANOMALY_DEFAULT;\n      }"),

    # --- every mode read says which mode it means ---
    # `!state.anomaly.mode` reads 'multi' as truthy and 'single' as truthy too. It is not a
    # shorter spelling of `!== 'multi'`; it inverts the branch.
    ("one mode read becomes a bare truthy test",
     "every state.anomaly.mode read is an explicit mode comparison",
     "            on = state.anomaly.rules.length === 0 && state.anomaly.mode !== 'multi';",
     "            on = state.anomaly.rules.length === 0 && !state.anomaly.mode;"),

    # --- the checkbox is drawn from the model ---
    ("a poll stops redrawing the 多选 checkbox from state",
     "the 多选 checkbox is drawn from state.anomaly.mode",
     "        if (dom.anomalyMulti) dom.anomalyMulti.checked = state.anomaly.mode === 'multi';", ""),

    # --- D2: the file stops claiming that one axis is the only filter ---
    # Prose, guarded because nothing about it is a runtime error: the sentence contradicts the
    # architecture and reappears the moment someone retypes it.
    ("the unqualified only-filter claim comes back above the kind table",
     "the client makes no unqualified claim that one axis is the only filter",
     "      var KIND_ORDER = ['user', 'steer',",
     "      // The type chips are the only filter.\n      var KIND_ORDER = ['user', 'steer',"),
    ("and it comes back on the kinds field itself",
     "the client makes no unqualified claim that one axis is the only filter",
     "        kinds: KIND_ORDER.slice(),",
     "        // The type chips are the only filter, so this array is the only definition.\n        kinds: KIND_ORDER.slice(),"),
]


def run_probe():
    proc = subprocess.run(
        ["node", str(PROBE)], cwd=str(ROOT), capture_output=True, text=True,
        encoding="utf-8", errors="replace",
    )
    fired = []
    for line in proc.stdout.splitlines():
        if line.startswith("FAIL "):
            fired.append(line[5:].strip())
    return proc.returncode == 0, fired, proc.stdout + proc.stderr


def main():
    original = WATCHED.read_bytes()
    ok, fired, output = run_probe()
    if not ok or fired:
        print("baseline verify-anomaly-model.mjs did not pass; refusing to run mutations")
        print(output)
        return 1

    failures = []
    for name, expected, old, new in CASES:
        text = original.decode("utf-8")
        count = text.count(old)
        if count != 1:
            failures.append("%s: anchor matched %d times, expected exactly 1" % (name, count))
            continue

        WATCHED.write_bytes(text.replace(old, new, 1).encode("utf-8"))
        try:
            passed, fired, _ = run_probe()
        finally:
            WATCHED.write_bytes(original)

        if passed:
            failures.append("%s: NOT CAUGHT — probe still passed" % name)
            continue
        if expected not in fired:
            failures.append("%s: caught by %s, expected %r" % (name, fired, expected))
            continue
        print("  caught by %s: %s" % (expected, name))

    if WATCHED.read_bytes() != original:
        failures.append("index.html was not restored byte-for-byte")
    else:
        print("index.html restored byte-for-byte")

    if failures:
        print("\nFAILURES:")
        for line in failures:
            print(" - " + line)
        return 1

    print("\nOK  (%d mutations, each caught by the guard that owns the rule)" % len(CASES))
    return 0


if __name__ == "__main__":
    sys.exit(main())
