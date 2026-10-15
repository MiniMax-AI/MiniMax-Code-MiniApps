"""Mutation control for the two turn-breakdown guards.

Without this, "turn breakdown parts sum to the headline" and "turn breakdown names 续作答答,
not 提问待答" could both be satisfied by a page that has nothing to do with the turns: the sum
check runs the real function against synthetic stats, but only once anyone writes it, and the
naming check is a regex over the whole file. This proves each guard actually fires.
"""
import io
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CLIENT = os.path.join(ROOT, "miniapp", "client", "index.html")
PROBE = os.path.join(HERE, "client-check.mjs")

# Anchored with the following line so it cannot also match turnTipLines, which builds the same
# expression for the tooltip — a shared substring is an ambiguous anchor, not a safe one.
CLOSED = ("'收尾 ' + formatInt(Math.max(0, total - open)),\n"
          "          '提问轮 ' + formatInt(asked)")
OPENED = "if (open > asked) parts.push('中断 ' + formatInt(open - asked));"
BOTH_PARTS = ("parts = [\n          '收尾 ' + formatInt(Math.max(0, total - open)),\n"
              "          '提问轮 ' + formatInt(asked)\n        ];")

MUTATIONS = [
    # If the closed part swallowed the open turns, the parts would total more than the
    # headline and the line would claim turns closed that never delivered a reply.
    ("closed part counts open turns too",
     CLOSED,
     "'收尾 ' + formatInt(total)",
     "turn breakdown parts sum to the headline"),
    # If the asked part were dropped, the gap would be silently absorbed by 中断.
    ("asked part dropped from the line",
     BOTH_PARTS,
     "parts = [\n          '收尾 ' + formatInt(Math.max(0, total - open))\n        ];",
     "turn breakdown parts sum to the headline"),
    # The word the earlier version shipped, and the boundary mark added after two disjoint
    # fives read as one number counted twice. Anchored on the rendered label / the boundary
    # string, not the bare word: the doc comments above these functions also talk about the
    # old names, and explaining a rename is not shipping it.
    ("label regressed to 提问待答",
     "'提问轮 ' + formatInt(asked)\n        ];",
     "'提问待答 ' + formatInt(asked)\n        ];",
     "turn breakdown renders 提问轮, not 提问待答"),
    # Removing 另有 is the exact regression this guard exists for: the two groups go back to
    # being one undifferentiated `·` run.
    ("boundary mark 另有 removed",
     "   ·   另有 ' + context",
     "   ·   ' + context",
     "context group is marked as a separate population"),
    ("whole breakdown and context line claims to sum to the headline",
     OPENED,
     "if (open > asked) parts.push('中断 ' + formatInt(0));",
     "turn breakdown parts sum to the headline"),
    # The inline links become a second opinion: they write state.kinds themselves instead of
    # going through the one writer, so the card and the chip could disagree.
    ("KPI link grows its own writer",
     "onKindToggle(kind, state.kinds.indexOf(kind) < 0);",
     "state.kinds = state.kinds.indexOf(kind) >= 0 ? state.kinds.filter(function (k) { return k !== kind; }) : state.kinds.concat([kind]);\n            renderLedger();",
     "KPI kind links go through onKindToggle, not a second writer"),
    # ...and they close over the rendered flag, which is stale the moment a poll lands between
    # the render and the click. Looks right, does the opposite.
    ("KPI link closes over a rendered flag",
     "onKindToggle(kind, state.kinds.indexOf(kind) < 0);",
     "onKindToggle(kind, on);",
     "KPI kind links do not close over a rendered flag"),
    # 续作轮 counts turns, not records. Wiring it up as if it were a kind would put a second
    # axis behind a name the chips already use.
    ("unlinkable term wired to a kind",
     "{ label: '续作轮', value: formatInt(stats.continuationTurns), kind: null }",
     "{ label: '续作轮', value: formatInt(stats.continuationTurns), kind: 'narration' }",
     "exactly the record-counting context terms are links"),
    # A tooltip nobody can reach without a mouse, or one the card no longer points at.
    ("tooltip loses its accessible name",
     "card.setAttribute('aria-describedby', tipId);",
     "card.setAttribute('data-note', tipId);",
     "turn card carries an accessible explanation"),
    # A tooltip that stops explaining the line it sits under.
    ("tooltip drops a term",
     "'收尾 ' + formatInt(Math.max(0, total - open)) + ' · 答复在本轮内交付',",
     "'这一类轮次在本轮内交付了答复',",
     "the tip explains every term on the line"),
    # The original defect: title and header both said 轮次, one a total one an ordinal. Put the
    # shared label back on either side and the two numbers look like they should be equal.
    ("turn header reverts to the shared label",
     "var title = '第 ' + (isCount(turn.index) ? turn.index : DASH) + ' 轮';",
     "var title = '轮次 ' + (isCount(turn.index) ? turn.index : DASH);",
     "panel title reads a total, turn headers read an ordinal"),
    # Put the session total back beside the range. This is the report verbatim: 共 84 轮 above
    # 第 82 轮, two scopes in one label, so the pair reads as a contradiction that no wording
    # can fix. Both numbers were true.
    ("session total put back in the title",
     "        var range = DASH;\n        if (isCount(firstTurn) && isCount(lastTurn)) {",
     "        var range = DASH;\n        if (isCount(state.payload && state.payload.stats ? state.payload.stats.turns : null)) return '共 ' + formatInt(state.payload.stats.turns) + ' 轮';\n        if (isCount(firstTurn) && isCount(lastTurn)) {",
     "panel title states only the rendered turn range"),
    ("title drops the range entirely",
     ": '第 ' + formatInt(firstTurn) + '–' + formatInt(lastTurn) + ' 轮';",
     ": '轨迹';",
     "panel title states only the rendered turn range"),
    # Anchored on two lines with their indentation: updateWindowBar() now writes the 全场 total in
    # both its mid-build and its settled branch, and a one-line anchor matches both.
    ("session total dropped from the window bar",
     "          (isCount(sessionTurns) ? '全场 ' + formatInt(sessionTurns) + ' 轮 · ' : '') +\n"
     "          '共 ' + formatInt(total) + ' 条' + matchedLabel + ' · 已显示 ' + formatInt(shown.length) + ' 条' +\n",
     "          '共 ' + formatInt(total) + ' 条' + matchedLabel + ' · 已显示 ' + formatInt(shown.length) + ' 条' +\n",
     "the session total lives on the window bar instead"),

    # The same rule for the other branch. The mid-build line is the one a reader is actually
    # looking at while an 18,924-row 全部 window is being built, so losing the session total there
    # is at least as bad as losing it once the table has settled.
    ("session total dropped from the mid-build count",
     "            (isCount(sessionTurns) ? '全场 ' + formatInt(sessionTurns) + ' 轮 · ' : '') +\n"
     "            '共 ' + formatInt(total) + ' 条 · 正在显示 ' + formatInt(ledgerProgress.rows) +\n",
     "            '共 ' + formatInt(total) + ' 条 · 正在显示 ' + formatInt(ledgerProgress.rows) +\n",
     "the session total lives on the window bar instead"),
    # Write the title before the groups exist. The label still renders, it just silently
    # degrades — the failure the guard above is about.
    ("title written before the groups are built",
     "dom.ledgerMeta.textContent = turnRangeLabel(firstTurn, lastTurn);",
     "dom.ledgerMeta.textContent = '共 ' + formatInt(state.payload.stats.turns) + ' 轮';",
     "the title is written after the groups are built"),
]

original = io.open(CLIENT, encoding="utf-8", newline="").read()


def run():
    proc = subprocess.run(["node", PROBE], cwd=HERE,
                          capture_output=True, text=True, encoding="utf-8", errors="replace")
    return proc.stdout + proc.stderr


ok = True
baseline = run()
base_ok = "0 failed" in baseline
print(("ok   " if base_ok else "FAIL ") + "baseline green")
ok = ok and base_ok

caught_all = []
for title, old, new, expect in MUTATIONS:
    if original.count(old) != 1:
        raise SystemExit("FAIL  anchor for %r matched %d times" % (title, original.count(old)))
    try:
        io.open(CLIENT, "w", encoding="utf-8", newline="").write(original.replace(old, new, 1))
        during = run()
        named = expect in during
        failed = "0 failed" not in during
        print(("ok   " if (named and failed) else "FAIL ") + "guard catches: " + title)
        for line in during.splitlines():
            if line.strip().startswith("-") and "breakdown" in line:
                print("       " + line.strip())
        caught_all.append(named and failed)
    finally:
        io.open(CLIENT, "w", encoding="utf-8", newline="").write(original)

restored = io.open(CLIENT, encoding="utf-8", newline="").read()
after = run()
after_ok = "0 failed" in after
print(("ok   " if restored == original else "FAIL ") + "client restored byte for byte")
print(("ok   " if after_ok else "FAIL ") + "green again after restore")

sys.exit(0 if (ok and all(caught_all) and restored == original and after_ok) else 1)