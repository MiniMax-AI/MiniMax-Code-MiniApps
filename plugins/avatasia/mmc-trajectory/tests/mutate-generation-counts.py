"""Mutation control for what the page says about a CONTEXT GENERATION, and for the two places a
row has to be named rather than its message.

Three numbers and one sentence, all of which the server hands over and the page renders:

  1. The picker's per-generation count. It used to be the catalog's `messageCount` — how many
     rows that file holds — which counts one message twice when the store recorded it twice and
     says nothing about how many messages the conversation has. It is now `logicalMessageCount`:
     how many logical messages THAT generation stores.
  2. The count beside the pinned generation. It is `stats.messagesAll`, the whole conversation,
     and it is deliberately not re-scoped to the generation on screen.
  3. The banner sentence. Promising a sealed snapshot "will not change with later turns" is true
     for a sealed generation and false for the live one, which the picker can also pin.

Plus the record key. `record.id` is the MESSAGE's id and one message expands into several rows —
a thought, a sentence and six tool calls share it. Anything that has to name ONE row (the scroll
anchor, the overview span, the time brush) has to use `record.index` instead; selection is the
deliberate exception, and two mutations below pin that from both sides.

Anchors are multi-line and index.html is LF, so they are written with bare \\n and the file is
read and written with newline='' — matching on normalised text while preserving the file's own
endings.
"""
import io
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CLIENT = os.path.join(ROOT, "miniapp", "client", "index.html")
PROBE = os.path.join(HERE, "client-check.mjs")

PICKER_COUNT = "            var stored = isCount(entry.logicalMessageCount) ? entry.logicalMessageCount : null;"
PICKER_LABEL = "            else if (isCount(stored)) label += '（' + formatInt(stored) + ' 条）';"
WHOLE_COUNT = "        return stats && isCount(stats.messagesAll) ? stats.messagesAll : 0;"
LIVE_TEST = "          var live = !session || !isCount(session.activeGeneration) || session.activeGeneration === shown;"

# The row key. `record.id` is the MESSAGE's id and one message expands into several rows, so
# anything that has to name one row has to use `record.index`. Selection is the deliberate
# exception — the last two mutations below are the guard saying so from both sides.
ROW_KEY = "  if (record && isCount(record.index)) return String(record.index);"
SPAN_KEY = "            id: recordKey(record),"
BRUSH_LOOKUP = "        var span = spansById.get(recordKey(record));"
HIT_TEST = "            return key === null ? null : (overviewSpansById.get(key) || null);"
CLICK_SELECT = "            selectRecord(span.record.id);"

MUTATIONS = [
    # The row key falls back to the message id again. This is the scroll anchor defect: the key
    # is read back with querySelector, which returns the first match, so a reader whose topmost
    # row was the seventh of eight comes back at the first.
    ("the row key falls back to the message id",
     ROW_KEY,
     "  if (record) return String(record.id);",
     "the row key prefers the row index over the message id"),
    ("the ledger row is keyed by its message again",
     "        row.setAttribute('data-row-id', recordKey(record));",
     "        row.setAttribute('data-row-id', record.id || String(record.index));",
     "a ledger row is keyed by its own row, not by its message"),
    # The span key. Same reason: the hover hairline, the tooltip and the time brush all have to
    # find the span the reader is pointing at, not the last one its message expanded into.
    ("an overview span is keyed by its message again",
     SPAN_KEY,
     "            id: record.id,",
     "an overview span is keyed by its row, not by its message"),
    ("the time brush looks a span up by the message id again",
     BRUSH_LOOKUP,
     "        var span = spansById.get(record.id);",
     "the time brush looks a span up by the row key too"),
    # And the split itself: one number cannot serve both, which is why the hit test hands back the
    # span rather than its key.
    ("the hit test returns the key again, so click and hover share one number",
     HIT_TEST,
     "            return key;",
     "the hit test returns the span, so click and hover stop sharing one number"),
    ("clicking a span selects the row rather than the message",
     CLICK_SELECT,
     "            selectRecord(span.id);",
     "clicking a span selects the message, not the row"),
    # The catalog row count back in the picker: a generation whose messages were recorded twice
    # reads as more messages than the conversation has.
    ("the picker counts stored rows again",
     PICKER_COUNT,
     "            var stored = isCount(entry.messageCount) ? entry.messageCount : null;",
     "generationOptions prefers the stored count over the catalog row count"),
    # ...or the label stops printing it at all, which is a quieter version of the same drift:
    # the option carries a count nobody is shown.
    ("the picker stops printing the count it carries",
     PICKER_LABEL,
     "            else if (false) label += '（' + formatInt(stored) + ' 条）';",
     "generationOptions archived label carries the stored count"),
    # The session-wide number re-scoped to the generation on screen leaves 「全部上下文共 N 条」
    # with nothing to compare against.
    ("the whole-context count is taken from the slice instead",
     WHOLE_COUNT,
     "        return stats && isCount(stats.messages) ? stats.messages : 0;",
     "the whole-context count reads the session total"),
    # The live generation described as a sealed snapshot: the promise is exactly wrong for the
    # generation still being written to.
    ("the banner calls the live generation a sealed snapshot",
     LIVE_TEST,
     "          var live = false;",
     "...and reads which one applies from the active generation"),
    # ...and the other direction, a sealed snapshot described as still growing.
    ("the banner calls a sealed snapshot live",
     LIVE_TEST,
     "          var live = true;",
     "...and reads which one applies from the active generation"),
]


def run():
    proc = subprocess.run(["node", PROBE], cwd=HERE, capture_output=True, text=True,
                          encoding="utf-8", errors="replace")
    return proc.stdout + proc.stderr


ok = True
baseline = run()
base_ok = "0 failed" in baseline
print(("ok   " if base_ok else "FAIL ") + "baseline green")
ok = ok and base_ok

caught_all = []
for title, old, new, expect in MUTATIONS:
    with io.open(CLIENT, encoding="utf-8", newline="") as handle:
        original = handle.read()
    if original.count(old) != 1:
        raise SystemExit("FAIL  anchor for %r matched %d times" % (title, original.count(old)))
    try:
        io.open(CLIENT, "w", encoding="utf-8", newline="").write(original.replace(old, new, 1))
        during = run()
        named = expect in during
        failed = "0 failed" not in during
        print(("ok   " if (named and failed) else "FAIL ") + "guard catches: " + title)
        if not named:
            for line in during.splitlines()[-6:]:
                print("       " + line.strip())
        caught_all.append(named and failed)
    finally:
        io.open(CLIENT, "w", encoding="utf-8", newline="").write(original)

with io.open(CLIENT, encoding="utf-8", newline="") as handle:
    restored = handle.read() == original
print(("ok   " if restored else "FAIL ") + "client restored byte for byte")
after = run()
after_ok = "0 failed" in after
print(("ok   " if after_ok else "FAIL ") + "green again after restore")

sys.exit(0 if (ok and all(caught_all) and restored and after_ok) else 1)
