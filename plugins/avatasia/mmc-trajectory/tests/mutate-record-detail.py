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
"""
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
    ),
    (
        "hasResult is taken on trust, so a tool result with no body still offers its tab",
        SERVER,
        "        hasResult: !isNilField(patch.result),",
        "        hasResult: true,",
    ),
    (
        "hasArguments counts an empty string as absent, which is not the test the page used",
        SERVER,
        "        hasArguments: patch.arguments !== null && patch.arguments !== undefined,",
        "        hasArguments: !isNilField(patch.arguments),",
    ),
    # --- the strip -------------------------------------------------------------------
    (
        "the strip leaves the body field on, so the page gets back everything it lost",
        SERVER,
        "      delete record.text;\n      delete record.thinking;",
        "      delete record.thinking;",
    ),
    (
        "the strip runs after the body was serialized, so it changes nothing that was sent",
        SERVER,
        "    slimPayloadForWire(payload);\n\n    let body;",
        "    let body;",
    ),
    (
        "the strip also runs on the search path, which still reads those fields in this process",
        SERVER,
        "    const needle = foldNeedle(asked);",
        "    const needle = foldNeedle(asked);\n    slimPayloadForWire({ turns: [] });",
    ),
    # --- which record the endpoint answers for ----------------------------------------
    (
        "every record claims position zero, so a line with several records answers for the first",
        SERVER,
        "        rowPos: rowPos++,",
        "        rowPos: 0,",
    ),
    (
        "the position is offered even for a record with no line to project",
        SERVER,
        "        if (rowPos !== null && typeof pos === 'number' && Number.isInteger(pos) && pos >= 0) {",
        "        if (rowPos !== null) {",
    ),
    (
        "the endpoint projects the row twice, so every position after the first is one off",
        SERVER,
        "      rows: [found.row],",
        "      rows: [found.row, found.row],",
    ),
    (
        "a position the one-row projection cannot produce is answered with whatever is nearest",
        SERVER,
        "    if (record === undefined) {",
        "    if (record === undefined) {\n      record = one.turns.flatMap((turn) => turn.records ?? [])[0];\n    }\n    if (record === undefined) {",
    ),
    (
        "the endpoint answers with a kind, which re-projecting one line cannot reproduce",
        SERVER,
        "    sendJson(response, 200, {\n      index: wanted,",
        "    sendJson(response, 200, {\n      index: wanted,\n      kind: record.kind,",
    ),
    # --- the summary the page used to assemble ----------------------------------------
    (
        "the tool-name step is dropped from the summary, so a tool result row shows nothing",
        SERVER,
        "      if (!record.summary) record.summary = record.toolName || record.title || '';",
        "      if (!record.summary) record.summary = '';",
    ),
    # --- the page --------------------------------------------------------------------
    (
        "the page decides 「has a body」 for itself again, from a field it no longer receives",
        CLIENT,
        "return !!record && record.kind === 'reply' && record.hasText === false;",
        "return !!record && record.kind === 'reply' && isNil(record.text);",
    ),
    (
        "the row falls back to the tool name itself, undoing the fold on the server",
        CLIENT,
        "        var summaryText = record.summary || '';",
        "        var summaryText = record.summary || record.toolName || '';",
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
    ),
    (
        "the tab is offered from a field the page no longer has, so it is always on",
        CLIENT,
        "            return record.kind === 'toolResult' && record.hasResult === true;",
        "            return record.kind === 'toolResult' && record.result !== null;",
    ),
    (
        "failure is decided by the field that was a duplicate, which no longer exists",
        CLIENT,
        "        var failed = record.isError === true;",
        "        var failed = !!(record.isError || record.error);",
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


def named_failure(output):
    """The first assertion the probe named, or None when it failed without naming one."""
    return next(
        (line.strip()[1:].strip() for line in output.splitlines()
         if line.strip().startswith("- ")),
        None,
    )


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
        for label, path, old, new in MUTATIONS:
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
            name = named_failure(output)
            if name is None:
                print(f"UNNAMED {label}: the probe failed without naming a rule")
                unnamed.append(label)
            else:
                print(f"caught {label}\n         -> {name}")
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
