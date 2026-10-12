"""Mutation control for the internalOnly flag and the 内部记账 rule.

Two files, two owning guards: the server half is owned by verify-raw-lazy.mjs (which builds a
payload and reads the record shape) and the client half by verify-anomaly.mjs (which runs the
rule table in a VM).

Both halves exist because of one finding: the payload carried neither `customType` nor
`display`, so the page had no way to tell a host-only record from any other system record —
docs/LAYERS.md D17. The flag is derived from `hostMetadata.providerVisibility === 'omit'`
rather than from a list of customType strings, and each mutation below breaks one link in that
chain rather than a link at random.

No anchor below contains a line ending. They used to be assembled with a hardcoded CRLF, which
matched only because core.autocrlf happened to rewrite the checkout, and it stopped matching the
moment .gitattributes pinned the working tree to LF -- the harness reported "anchor matched 0
times" and exited, which is the correct failure but for a reason nobody had chosen. Where a
mutation has to *insert* a line it still needs an ending, so that one is read out of the file it
is about to edit: it cannot be wrong about a file it just measured.
"""
import io
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SERVER = os.path.join(ROOT, "miniapp", "node", "server.mjs")
CLIENT = os.path.join(ROOT, "miniapp", "client", "index.html")


def read(rel):
    with io.open(rel, encoding="utf-8", newline="") as f:
        return f.read()


# The ending to insert with, measured from the file itself. Never hardcoded.
L = "\r\n" if "\r\n" in read(SERVER) else "\n"

# (title, file, old, new, owning guard, assertion names that must fire by name)
MUTATIONS = [
    # The runtime requires role === 'custom' before it looks at hostMetadata at all. Dropping
    # that check would flag every assistant turn that ever carried the key.
    ("the role check is dropped, so any omit marker counts",
     SERVER,
     "  if (record.role !== 'custom') return false;",
     "",
     "verify-raw-lazy.mjs",
     ["the omit marker on an assistant record is not honoured"]),

    # 'pass' is a real value. Matching on presence rather than on the value flags it too.
    ("any providerVisibility value counts as omit",
     SERVER,
     "    && metadata.providerVisibility === 'omit';",
     "    && metadata.providerVisibility !== undefined;",
     "verify-raw-lazy.mjs",
     ["a different providerVisibility value is not flagged"]),

    # A field that is sometimes present and sometimes absent splits the page into two
    # conventions: one place checks truthiness, another checks `=== true`. Returning undefined
    # makes the field optional, which is how those two drift apart.
    ("the flag comes back undefined instead of false",
     SERVER,
     "export function isHostOnlyMessage(message) {",
     "export function isHostOnlyMessage(message) {" + L + "  if (message) return undefined;" + L,
     "verify-raw-lazy.mjs",
     ["every record carries the field, so it is never undefined"]),

    # The record must stay in the payload. `index` counts emitted rows, so dropping these rows
    # renumbers every record after them and silently breaks a live ?since= cursor — this is the
    # reason the fix is a flag and not a filter. docs/LAYERS.md D17.
    ("host-only records stop being emitted at all",
     SERVER,
     "    const push = (patch) => {",
     "    const push = (patch) => {" + L + "      if (isHostOnlyMessage(source)) return;" + L,
     "verify-raw-lazy.mjs",
     ["exactly the settlement record is flagged internal",
      "a host-only record is still in the payload, still numbered"]),

    # The client half: a predicate that matches on kind instead of on the flag would keep the
    # count plausible and select the wrong rows — every blank system record, and every reminder.
    ("the rule selects on kind instead of on the flag",
     CLIENT,
     "            return !!record && record.internalOnly === true;",
     "            return !!record && record.kind === 'system';",
     "verify-anomaly.mjs",
     ["hostOnly fires on a record the server flagged internal",
      "hostOnly does not fire on an ordinary record"]),
]

GUARDS = {
    "verify-raw-lazy.mjs": os.path.join(HERE, "verify-raw-lazy.mjs"),
    "verify-anomaly.mjs": os.path.join(HERE, "verify-anomaly.mjs"),
}

ORIGINALS = {SERVER: io.open(SERVER, encoding="utf-8", newline="").read(),
             CLIENT: io.open(CLIENT, encoding="utf-8", newline="").read()}


def run(guard):
    proc = subprocess.run(["node", GUARDS[guard]], cwd=HERE,
                          capture_output=True, text=True, encoding="utf-8", errors="replace")
    return proc.returncode, proc.stdout + proc.stderr


ok = True
raw_code, raw_out = run("verify-raw-lazy.mjs")
raw_ok = raw_code == 0 and "FAILED" not in raw_out
anomaly_code, anomaly_out = run("verify-anomaly.mjs")
anomaly_ok = anomaly_code == 0 and "FAILED_NAMES\t[]" in anomaly_out
print(("ok   " if raw_ok else "FAIL ") + "baseline: verify-raw-lazy green")
print(("ok   " if anomaly_ok else "FAIL ") + "baseline: verify-anomaly green")
ok = ok and raw_ok and anomaly_ok

caught_all = []
for title, path, old, new, guard, expects in MUTATIONS:
    if ORIGINALS[path].count(old) != 1:
        raise SystemExit("FAIL  anchor for %r matched %d times"
                         % (title, ORIGINALS[path].count(old)))
    try:
        io.open(path, "w", encoding="utf-8", newline="").write(
            ORIGINALS[path].replace(old, new, 1))
        during_code, during = run(guard)
    finally:
        io.open(path, "w", encoding="utf-8", newline="").write(ORIGINALS[path])
    named = [name for name in expects if name in during]
    failed = during_code != 0 or "FAILED" in during
    good = failed and len(named) == len(expects)
    print(("ok   " if good else "FAIL ") + "guard catches: " + title)
    for name in expects:
        print(("       caught by name: " + name) if name in named else ("       MISSED:  " + name))
    caught_all.append(good)

restored = all(io.open(p, encoding="utf-8", newline="").read() == ORIGINALS[p] for p in ORIGINALS)
print(("ok   " if restored else "FAIL ") + "both files restored byte for byte")

final_raw_code, final_raw = run("verify-raw-lazy.mjs")
final_anomaly_code, final_anomaly = run("verify-anomaly.mjs")
green = final_raw_code == 0 and "FAILED" not in final_raw and final_anomaly_code == 0
print(("ok   " if green else "FAIL ") + "green again after restore")

sys.exit(0 if (ok and all(caught_all) and restored and green) else 1)