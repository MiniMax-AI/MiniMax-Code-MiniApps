"""Mutation control for verify-raw-lazy.mjs.

Each mutation reintroduces exactly one regression the probe is supposed to catch, and the
file must come back byte-for-byte afterwards. Anchors are matched against LF-normalised text
and written back in each file's own newline (server.mjs is CRLF, index.html is LF) — matching
raw bytes would make every multi-line anchor miss, and the runner reports a missed anchor the
same way it reports a surviving mutation, which hides which one broke.
"""
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
SERVER = ROOT / "miniapp" / "node" / "server.mjs"
CLIENT = ROOT / "miniapp" / "client" / "index.html"
PROBE = HERE / "verify-raw-lazy.mjs"

MUTATIONS = [
    # ---- the bulk payload must not carry the message -------------------------
    (
        "server: the record carries the message again, so every poll serializes the session",
        SERVER,
        "      rawRow: rowIndex,\n",
        "      rawRow: rowIndex, raw: source,\n",
    ),
    (
        "server: the omitted verdict goes back on the record",
        SERVER,
        "      rawRow: rowIndex,\n",
        "      rawRow: rowIndex, rawOmitted: false,\n",
    ),
    # ---- the locator must actually point at the row -------------------------
    (
        "server: every locator points at the first row",
        SERVER,
        "      raws.set(index, rowIndex);",
        "      raws.set(index, 0);",
    ),
    (
        # The line grew a `typeof` clause when a null locator was found resolving to row zero;
        # the check this removes is the same one, at the same place.
        "server: a locator past the end of rows is accepted",
        SERVER,
        "      if (Number.isInteger(index) && index > 0 && typeof rowIndex === 'number' && Number.isInteger(rowIndex) && rowIndex >= 0) {\n",
        "      if (Number.isInteger(index) && index > 0) {\n",
    ),
    (
        "server: the locator is not removed from the record, so it reaches the page",
        SERVER,
        "      delete record.rawRow;\n",
        "",
    ),
    # ---- /raw must build, and must say --------------------------------------
    (
        "server: /raw hands back a stored message instead of building one",
        SERVER,
        "    const built = buildRawPayload(found.row.message, redact);\n",
        "    const built = { value: found.row.message, omitted: false };\n",
    ),
    (
        "server: /raw stops reporting whether the message was too large",
        SERVER,
        "sendJson(response, 200, { index: wanted, raw: built.value, omitted: built.omitted });",
        "sendJson(response, 200, { index: wanted, raw: built.value });",
    ),
    (
        "server: /raw keeps the rows out of the cache entry, so it cannot resolve a locator",
        SERVER,
        "body, raws, rowPos: rowPosByRecord, decoded: new Map() });",
        "body, decoded: new Map() });",
    ),
    # ---- the cap must still hold, wherever it now lives ----------------------
    (
        "server: the 64 KB cap stops being applied, so a huge message is carried whole",
        SERVER,
        "  if (Buffer.byteLength(serialized, 'utf8') > MAX_RAW_BYTES) return { value: null, omitted: true };",
        "  if (false) return { value: null, omitted: true };",
    ),
    # ---- the five readers ---------------------------------------------------
    (
        "client: the handoff reads the verdict off the record again",
        CLIENT,
        "        if (rawOmitted) lines.push('- 提示：原文过大已被省略。');",
        "        if (record.rawOmitted) lines.push('- 提示：原文过大已被省略。');",
    ),
    (
        "client: rawSourceFor short-circuits on a field that no longer exists",
        CLIENT,
        "      function rawSourceFor(record) {\n        return fetchRaw(record);\n      }",
        "      function rawSourceFor(record) {\n        if (record && record.rawOmitted) return Promise.resolve({ raw: null, omitted: true });\n        return fetchRaw(record);\n      }",
    ),
    (
        "client: the raw tab stops drawing the omitted notice",
        CLIENT,
        "          if (fetched.omitted === true) {\n",
        "          if (false) {\n",
    ),
    (
        # Anchored on the insertBefore above it, not on the dash alone. `pre.textContent = DASH;`
        # followed by `return;` now appears twice — once where an omitted message is drawn and once
        # where a detail read came back empty — and an anchor loose enough to match either made this
        # rewrite the wrong one, which the guard's own substring could not tell apart.
        "client: the raw tab shows the message even when it was omitted",
        CLIENT,
        "              pre\n            );\n            pre.textContent = DASH;\n            return;",
        "              pre\n            );\n            pre.innerHTML = jsonColorize(fetched.raw);\n            return;",
    ),
    (
        "client: copySelected stops honouring the omitted verdict",
        CLIENT,
        "          var noRaw = fetched.omitted === true || fetched.raw === null || fetched.raw === undefined;",
        "          var noRaw = fetched.raw === null || fetched.raw === undefined;",
    ),
    (
        "client: fetchRaw caches the message but drops the verdict",
        CLIENT,
        "            var entry = { raw: result.body.raw, omitted: result.body.omitted === true };",
        "            var entry = { raw: result.body.raw, omitted: false };",
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
        ["node", str(PROBE)],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    return proc.returncode, (proc.stdout or "") + (proc.stderr or "")


def main():
    code, output = run_probe()
    if code != 0:
        print("baseline probe does not pass; fix that first")
        print(output)
        return 1
    print("baseline clean")

    originals = {path: path.read_bytes() for path in {m[1] for m in MUTATIONS}}
    missed = []
    for label, path, old, new in MUTATIONS:
        text, newline = read_exact(path)
        if old not in text:
            print(f"SKIP  {label}: anchor not found in {path.name}")
            missed.append(label)
            continue
        write_exact(path, text.replace(old, new, 1), newline)
        try:
            code, output = run_probe()
        finally:
            path.write_bytes(originals[path])
        if code == 0:
            print(f"MISSED {label}: the probe still passed")
            missed.append(label)
        else:
            first = next(
                (line.strip() for line in output.splitlines() if line.strip().startswith("- ")),
                "(no detail)",
            )
            print(f"caught {label}\n         -> {first}")

    for path, data in originals.items():
        if path.read_bytes() != data:
            print(f"NOT RESTORED {path}")
            return 1
    print("all files restored byte-for-byte")

    if missed:
        print(f"\n{len(missed)} mutation(s) got through")
        return 1
    print(f"\nall {len(MUTATIONS)} mutations caught")
    return 0


if __name__ == "__main__":
    sys.exit(main())