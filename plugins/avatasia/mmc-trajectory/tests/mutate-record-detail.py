"""Mutation control for the payload slimming and the record-detail endpoint.

The page stopped being sent `text`, `thinking`, `arguments` and `result`, which were 59.1% of the
body measured over this machine's whole store. Four presence flags took their place and
`/api/trajectory/record` answers for one record at a time. A move like that fails in ways that
render fine:

  - a flag that disagrees with the value it was measured from draws an empty tab, or hides one;
  - a strip that is applied a step too late still produces a correct body and a fat one;
  - a `rowPos` that is not per-row answers with another record's thinking block;
  - a summary chain that loses its tool-name step puts `—` where a row used to name its tool.

Each mutation below is one of those, and each has to be caught **by name** — a guard that fails
for some other reason is not evidence that this one was caught.

Every case names the rule it breaks in its `expect` field, and a case counts as caught only when
the probe reported THAT rule: a probe that went red on some other assertion has not shown that
this guard owns this mutation.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
SERVER = ROOT / "miniapp" / "node" / "server.mjs"
CLIENT = ROOT / "miniapp" / "client" / "index.html"
PROBE = HERE / "verify-record-detail.mjs"

MUTATIONS = [
    # --- the flags -------------------------------------------------------------------
    (
        "hasText is taken on trust instead of measured, so an empty reply claims a body",
        SERVER,
        "        hasText: !isNilField(patch.text),",
        "        hasText: true,",
        'a body-less reply reports no text',
    ),
    (
        "hasResult is taken on trust, so a tool result with no body still offers its tab",
        SERVER,
        "        hasResult: !isNilField(patch.result),",
        "        hasResult: true,",
        'hasResult matches "result" on #1 (user)',
    ),
    (
        "hasArguments counts an empty string as absent, which is not the test the page used",
        SERVER,
        "        hasArguments: patch.arguments !== null && patch.arguments !== undefined,",
        "        hasArguments: !isNilField(patch.arguments),",
        'an empty string counts as arguments, because that is what the page tested',
    ),
    # --- the strip -------------------------------------------------------------------
    (
        "the strip leaves the body field on, so the page gets back everything it lost",
        SERVER,
        "      delete record.text;\n      delete record.thinking;",
        "      delete record.thinking;",
        '"text" is gone from the wire',
    ),
    (
        "the strip runs after the body was serialized, so it changes nothing that was sent",
        SERVER,
        "    slimPayloadForWire(payload);\n\n    let body;",
        "    let body;",
        'the trajectory route strips before serializing',
    ),
    (
        "the strip also runs on the search path, which still reads those fields in this process",
        SERVER,
        "    const needle = foldNeedle(asked);",
        "    const needle = foldNeedle(asked);\n    slimPayloadForWire({ turns: [] });",
        'the search path does not strip, because it still reads those fields in this process',
    ),
    # --- which record the endpoint answers for ----------------------------------------
    (
        "every record claims position zero, so a line with several records answers for the first",
        SERVER,
        "        rowPos: rowPos++,",
        "        rowPos: 0,",
        'line 1 numbers its records 0..n-1 with no repeats',
    ),
    (
        "the position is offered even for a record with no line to project",
        SERVER,
        "        if (rowPos !== null && typeof pos === 'number' && Number.isInteger(pos) && pos >= 0) {",
        "        if (rowPos !== null) {",
        'a record whose position is "x" gets no position',
    ),
    (
        "the endpoint projects the row twice, so every position after the first is one off",
        SERVER,
        "      rows: [found.row],",
        "      rows: [found.row, found.row],",
        'it re-projects a single row rather than the session',
    ),
    (
        "a position the one-row projection cannot produce is answered with whatever is nearest",
        SERVER,
        "    if (record === undefined) {",
        "    if (record === undefined) {\n      record = one.turns.flatMap((turn) => turn.records ?? [])[0];\n    }\n    if (record === undefined) {",
        'and nothing replaces it afterwards',
    ),
    (
        "the endpoint answers with a kind, which re-projecting one line cannot reproduce",
        SERVER,
        "    sendJson(response, 200, {\n      index: wanted,",
        "    sendJson(response, 200, {\n      index: wanted,\n      kind: record.kind,",
        'and does NOT answer with a kind, which re-projecting one line cannot reproduce faithfully',
    ),
    # --- the summary the page used to assemble ----------------------------------------
    (
        "the tool-name step is dropped from the summary, so a tool result row shows nothing",
        SERVER,
        "      if (!record.summary) record.summary = record.toolName || record.title || '';",
        "      if (!record.summary) record.summary = '';",
        'while its summary is not empty, so hasText cannot be read off it',
    ),
    # --- the page --------------------------------------------------------------------
    (
        "the page decides 「has a body」 for itself again, from a field it no longer receives",
        CLIENT,
        "return !!record && record.kind === 'reply' && record.hasText === false;",
        "return !!record && record.kind === 'reply' && isNil(record.text);",
        'the 空答复 rule reads the flag, not a field the page no longer receives',
    ),
    (
        "the row falls back to the tool name itself, undoing the fold on the server",
        CLIENT,
        "        var summaryText = record.summary || '';",
        "        var summaryText = record.summary || record.toolName || '';",
        'the row summary is the one server-derived field, with no fallback chain under it',
    ),
    (
        # The replacement text is written in live code on purpose. It used to call
        # `buildBlock(...)`, which was retired as dead — leaving it would have turned this
        # control into a crash (`ReferenceError` at render time) instead of a named failure,
        # and a control that crashes reports nothing. The defect under test is unchanged: the
        # 结果 tab renders `record.result` directly, which after the payload slimming is always
        # empty, instead of going through the folding builder.
        "the 结果 tab renders the record again, which after the slimming is always empty",
        CLIENT,
        "        if (tabId === 'result') return buildDetailBlock('工具结果', record, 'result', false);",
        "        if (tabId === 'result') return el('div', 'note', String(record.result));",
        'the 工具结果 panel draws "result" from the detail, not off the record',
    ),
    (
        "the tab is offered from a field the page no longer has, so it is always on",
        CLIENT,
        "            return record.kind === 'toolResult' && record.hasResult === true;",
        "            return record.kind === 'toolResult' && record.result !== null;",
        'and the 工具结果 tab is offered from hasResult',
    ),
    (
        "failure is decided by the field that was a duplicate, which no longer exists",
        CLIENT,
        "        var failed = record.isError === true;",
        "        var failed = !!(record.isError || record.error);",
        'failure is decided by isError alone, which is what the old `|| error` always agreed with',
    ),
]


def read_exact(path):
    data = path.read_bytes()
    text = data.decode("utf-8").replace("\r\n", "\n")
    return text, ("\r\n" if b"\r\n" in data else "\n")


def write_exact(path, text, newline):
    if newline == "\r\n":
        text = text.replace("\n", "\r\n")
    path.write_bytes(text.encode("utf-8"))


def run_probe():
    proc = subprocess.run(
        ["node", str(PROBE)], cwd=str(ROOT), capture_output=True, text=True,
        encoding="utf-8", errors="replace",
    )
    return proc.returncode, (proc.stdout or "") + (proc.stderr or "")


def rule_name(text):
    """The name of a rule a probe reported, without the evidence a comparison carries.

    A probe reports an assertion as `<name>` and a comparison as
    `<name>: got <value>, want <value>`. The values are the evidence, not the rule, so they are
    cut off — and the cut is made at a `: got ` whose tail really is `<json>, want <json>`, so a
    name that itself contains those words is not truncated.
    """
    for match in reversed(list(re.finditer(re.escape(": got "), text))):
        head = text[:match.start()].strip()
        tail = text[match.end():]
        cut = tail.rfind(", want ")
        if cut < 0:
            continue
        try:
            json.loads(tail[:cut])
            json.loads(tail[cut + len(", want "):])
        except ValueError:
            continue
        return head
    return text


def reported_rules(output):
    """The rules a probe named as broken.

    The probe prints one `  - <name>` line per failure, so a case is only caught when the rule
    it names is among them.
    """
    names = []
    for line in output.splitlines():
        text = line.strip()
        if text.startswith("- "):
            names.append(rule_name(text[2:].strip()))
        elif text.startswith("FAIL "):
            names.append(rule_name(text[5:].strip()))
    return names


def main():
    code, output = run_probe()
    if code != 0:
        print("baseline probe does not pass; fix that first")
        print(output)
        return 1
    print("baseline clean")

    originals = {path: path.read_bytes() for path in {m[1] for m in MUTATIONS}}
    missed, unnamed = [], []
    try:
        for label, path, old, new, expect in MUTATIONS:
            text, newline = read_exact(path)
            if old not in text:
                print(f"SKIP  {label}: anchor not found")
                missed.append(label)
                continue
            if old == new:
                print(f"SKIP  {label}: the mutation changes nothing")
                missed.append(label)
                continue
            write_exact(path, text.replace(old, new, 1), newline)
            try:
                code, output = run_probe()
            finally:
                write_exact(path, text, newline)
            if code == 0:
                print(f"MISSED {label}: the probe still passed")
                missed.append(label)
                continue
            names = reported_rules(output)
            if not names:
                print(f"UNNAMED {label}: the probe failed without naming a rule")
                unnamed.append(label)
                continue
            # The case names the rule it is about, so the probe has to name THAT rule and not
            # some other one that happened to go red in the same run: a probe that went red
            # elsewhere has not shown that this guard owns this mutation.
            if expect not in names:
                print(f"MISSED {label}: the probe named {names} instead of {expect}")
                missed.append(label)
                continue
            print(f"caught {label}\n         -> {expect}")
    finally:
        for path, data in originals.items():
            path.write_bytes(data)

    not_restored = [str(p) for p, data in originals.items() if p.read_bytes() != data]
    if not_restored:
        print("NOT RESTORED " + ", ".join(not_restored))
        return 1
    print("files restored byte-for-byte")

    if missed or unnamed:
        if missed:
            print(f"\n{len(missed)} mutation(s) got through")
        if unnamed:
            print(f"{len(unnamed)} mutation(s) failed without naming a rule")
        return 1
    print(f"\nall {len(MUTATIONS)} mutations caught, each by name")
    return 0


if __name__ == "__main__":
    sys.exit(main())
