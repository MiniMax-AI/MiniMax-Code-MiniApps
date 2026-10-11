"""Mutation control for the 记录序号 column guards in client-check.mjs.

Every mutation here has to be caught, and caught *by the guard that owns the defect*.
A mutation that trips some unrelated assertion proves nothing, so each case names the
guard it expects and the runner fails loudly when a different one fires.

The file is read and written as bytes and only the mutated substring is replaced, so
line endings are never touched: index.html is LF, and a blanket read_text/write_text
round trip would rewrite it to CRLF and trip CSS regexes that have nothing to do with
this bug.
"""
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
CLIENT = ROOT / "miniapp" / "client" / "index.html"
CHECK = HERE / "client-check.mjs"

WIDTH_GUARD = "the 序号 column is wide enough for the label it must show"
SHARED_GUARD = "every grid that renders a 序号 uses the shared column"
CONTAIN_GUARD = "a 序号 that still does not fit is ellipsised, never spilled onto the pill"
RANGE_WIDTH_GUARD = "the 时间区间 pickers are sized by their content, not by a fixed width"
RANGE_NO_PX_GUARD = "and no later rule gives the 时间区间 pickers a width"

# A `datetime-local` is laid out by the browser from the localized date it has to draw, so the
# guard is about the absence of a fixed width rather than about a number. The mutations are the
# two ways that absence could end: a width added, and the flex context that stops the toolbar
# squeezing the control removed.
# `flex: none` appears on a dozen rules, so the anchor carries the line above it — which is the
# end of this rule's own comment, so it cannot drift onto another rule.
RANGE_FLEX = "another route. */\n        flex: none;\n"

CASES = [
    # Guard 1 — the width. 42px is the value that caused the report; 60px is a
    # plausible-looking but still-insufficient number (needs 67.2), so a check that
    # merely demanded "not 42" would let this through.
    ("width back to 42px", WIDTH_GUARD,
     "--traj-index-col: 72px;", "--traj-index-col: 42px;"),
    ("width narrowed to 60px", WIDTH_GUARD,
     "--traj-index-col: 72px;", "--traj-index-col: 60px;"),
    # Guard 1 — uniqueness. A second declaration leaves the tracks disagreeing.
    ("second declaration of the column", WIDTH_GUARD,
     "--traj-index-col: 72px;", "--traj-index-col: 72px;\n      }\n      :root {\n        --traj-index-col: 40px;"),
    # Guard 2 — every site that renders a 序号, including the narrow override that
    # silently produced the phone behaviour.
    (".row track back to a literal 42px", SHARED_GUARD,
     "grid-template-columns: var(--traj-index-col) 76px minmax(0, 1fr) 68px 76px;\n        align-items: center;",
     "grid-template-columns: 42px 76px minmax(0, 1fr) 68px 76px;\n        align-items: center;"),
    (".compaction-band track back to a literal 42px", SHARED_GUARD,
     "grid-template-columns: var(--traj-index-col) auto minmax(0, 1fr) auto;",
     "grid-template-columns: 42px auto minmax(0, 1fr) auto;"),
    (".skeleton-row track back to a literal 42px", SHARED_GUARD,
     "grid-template-columns: var(--traj-index-col) 76px minmax(0, 1fr) 68px 76px;\n        gap: 8px;",
     "grid-template-columns: 42px 76px minmax(0, 1fr) 68px 76px;\n        gap: 8px;"),
    ("narrow override back to 28px", SHARED_GUARD,
     "grid-template-columns: var(--traj-index-col) 64px minmax(0, 1fr) 54px 66px;",
     "grid-template-columns: 28px 64px minmax(0, 1fr) 54px 66px;"),
    # Guard 3 — containment. Anchored on the comment rather than on the three
    # declarations: `overflow/text-overflow/white-space` appears elsewhere in this file,
    # so the properties alone are not a unique key.
    ("containment dropped", CONTAIN_GUARD,
     "ellipsis reads as a number this row could not show in full. */\n"
     "        overflow: hidden;\n        text-overflow: ellipsis;\n        white-space: nowrap;\n",
     "ellipsis reads as a number this row could not show in full. */\n"),

    # The 时间区间 pickers, which had the same defect twice and a third way: a width fixed by
    # yesterday's content, on a control the browser already knows how wide to make.
    ("the picker given a fixed width again", RANGE_WIDTH_GUARD,
     RANGE_FLEX, "        width: 20ch;\n"),
    ("the picker left shrinkable inside the toolbar", RANGE_WIDTH_GUARD,
     RANGE_FLEX, ""),
    ("a later rule puts a width back", RANGE_NO_PX_GUARD,
     "\n      .range-sep {", "\n      .range-input {\n        width: 88px;\n      }\n      .range-sep {"),
]


def run_check():
    proc = subprocess.run(
        [ "node", str(CHECK) ], cwd=str(HERE), capture_output=True, text=True,
        encoding="utf-8", errors="replace",
    )
    return proc.returncode == 0, proc.stdout + proc.stderr


def main():
    original = CLIENT.read_bytes()
    ok, output = run_check()
    if not ok:
        print("baseline client-check.mjs did not pass; refusing to run mutations")
        print(output)
        return 1

    failures = []
    for name, expected_guard, old, new in CASES:
        text = original.decode("utf-8")
        if text.count(old) != 1:
            failures.append(f"{name}: anchor matched {text.count(old)} times, expected exactly 1")
            continue

        CLIENT.write_bytes(text.replace(old, new, 1).encode("utf-8"))
        try:
            passed, mutated_output = run_check()
        finally:
            CLIENT.write_bytes(original)

        if passed:
            failures.append(f"{name}: NOT CAUGHT — client-check.mjs still passed")
            continue

        fired = [g for g in (WIDTH_GUARD, SHARED_GUARD, CONTAIN_GUARD,
                             RANGE_WIDTH_GUARD, RANGE_NO_PX_GUARD)
                 if ("policy: " + g) in mutated_output]
        if fired != [expected_guard]:
            failures.append(f"{name}: caught by {fired or 'nothing'}, expected ['{expected_guard}']")
            continue

        print(f"  caught by the right guard: {name}")

    restored = CLIENT.read_bytes() == original
    if not restored:
        failures.append("index.html was not restored byte-for-byte")
    else:
        print("index.html restored byte-for-byte")

    if failures:
        print("\nFAILURES:")
        for line in failures:
            print(" - " + line)
        return 1

    print(f"\nOK  ({len(CASES)} mutations, each caught by its own guard)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
