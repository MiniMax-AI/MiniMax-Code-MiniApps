"""Mutation control for `/api/runtime`'s one contract: what it does not send.

This is the only route in the package whose promise is entirely about withholding. Its own comment
says it — 「Names and structure only」, and 「this route must never hand the browser a filesystem
location」 — and asking a promise-to-guard map which rows had no owner returned this one.

Asking is what found the hole. Three fields in the response are not basenames, counts or flags; they
are substrings of exception text, and each of them went out raw:

    sqlite.error       the message from importing node:sqlite
    sqlite.queryError  the message from a database that could not be opened or queried
    diagError          the STACK of anything the handler itself threw

`diagError` is the one that leaked on every single run. A Node stack frame names the file it is in
by absolute path, once per frame, so 600 characters of one is mostly directory names — and on Windows
those carry the user profile directory. It fired on exactly the failure paths the route exists to
report, so the reader looking at that output is the reader already having a bad day. In a package
that installs onto every reader's machine, that is an identity leak and it contradicted the route's
own stated promise.

Two passes now, in this order, and then the clip:

  1. `redact` — the three store locations, in the spelling they were handed;
  2. `scrubAbsolutePaths` — anything absolute at all, in any spelling.

The second is not redundant and the mutations below are grouped to show why. A stack frame is printed
as a URL (`file:///C:/Users/...`), with forward slashes and a scheme, so the backslash prefixes miss
every frame of it; the store's `.minimax` fallback catches the store's own directories and leaves
everything else — the node install, a temp directory, a dependency — standing. The guard measures
that gap on a real stack rather than asserting it.

Deliberately NOT folded into `createRedactor`: that one also runs over session CONTENT, where
blanking an unrelated string would change what a reader is shown. A stack carries nothing a reader
came for, which is exactly why the blunt version is allowed here and not there.

Each mutation reverts one field and requires `verify-runtime-diag.mjs` to report it by name.
"""
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
SERVER = ROOT / "miniapp" / "node" / "server.mjs"
PROBE = HERE / "verify-runtime-diag.mjs"

REDACT = "redact(String(/** @type {any} */ (error)?."

MUTATIONS = [
    (
        "the handler's own stack goes out raw, so the route publishes a directory per frame",
        "    diagError = scrubAbsolutePaths(redact(String(/** @type {any} */ (error)?.stack ?? error))).slice(0, 600);",
        "    diagError = String(/** @type {any} */ (error)?.stack ?? error).slice(0, 600);",
        "SHAPE: diagError goes through both passes",
    ),
    (
        "a database that could not be opened reports its own path in the error field",
        "      sqlite.error = scrubAbsolutePaths(redact(String(/** @type {any} */ (error)?.message ?? error))).slice(0, 200);",
        "      sqlite.error = String(/** @type {any} */ (error)?.message ?? error).slice(0, 200);",
        "SHAPE: sqlite.error goes through both passes",
    ),
    (
        "a query that could not be answered reports its own path in the query-error field",
        "        sqlite.queryError = scrubAbsolutePaths(redact(String(/** @type {any} */ (error)?.message ?? error))).slice(0, 240);",
        "        sqlite.queryError = String(/** @type {any} */ (error)?.message ?? error).slice(0, 240);",
        "SHAPE: sqlite.queryError goes through both passes",
    ),
    # The order one. Both passes, then the clip — and moving the clip inside the scrub is a different
    # defect with the same smell: cutting a path at 600 characters can leave a drive-qualified
    # fragment standing, which is still a profile directory as far as a reader is concerned.
    (
        "the path is clipped before it is scrubbed, so a long stack leaves half a path behind",
        "    diagError = scrubAbsolutePaths(redact(String(/** @type {any} */ (error)?.stack ?? error))).slice(0, 600);",
        "    diagError = scrubAbsolutePaths(redact(String(/** @type {any} */ (error)?.stack ?? error).slice(0, 600)));",
        "SHAPE: diagError is redacted and scrubbed BEFORE it is clipped, so no path is cut in half",
    ),
    # And the two fields that are supposed to stay names. These are the easy half of the contract
    # and they have no behavioural check either, for the same reason as the rest: the handler is a
    # closure inside `start()` and this suite never starts the runtime.
    (
        "the database file is published as the whole path instead of its name",
        "      sqlite.dbFile = basename(join(location.root, 'v2', 'sqlite', 'runtime-state.sqlite'));",
        "      sqlite.dbFile = join(location.root, 'v2', 'sqlite', 'runtime-state.sqlite');",
        "the database file is published as a basename",
    ),
    (
        "the data directory is published whole, which on Windows is the user profile directory",
        "      dataDirBasename: basename(context.dataDir) || null,",
        "      dataDirBasename: context.dataDir || null,",
        "dataDirBasename is a basename and not the value it was derived from",
    ),
    (
        "the working directory is published whole, which is an absolute path too",
        "      cwdBasename: basename(process.cwd()) || null,",
        "      cwdBasename: process.cwd(),",
        "the runtime route publishes no absolute path",
    ),
]


def read_exact(path):
    """Normalise to LF for matching, and report the file's own newline so it can be put back."""
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
        cwd=str(ROOT), capture_output=True, text=True,
        encoding="utf-8", errors="replace",
    )
    return proc.returncode, (proc.stdout or "") + (proc.stderr or "")


def named_failures(output):
    return [
        line.strip()[len("FAIL"):].strip()
        for line in output.splitlines()
        if line.strip().startswith("FAIL")
    ]


def main():
    code, output = run_probe()
    if code != 0:
        print("baseline probe does not pass; fix that first")
        print(output)
        return 1
    print("baseline clean")

    original = SERVER.read_bytes()
    missed, unnamed = [], []
    for label, old, new, expect in MUTATIONS:
        text, newline = read_exact(SERVER)
        if old not in text:
            print(f"SKIP  {label}: anchor not found")
            missed.append(label)
            continue
        if old == new:
            print(f"SKIP  {label}: the mutation changes nothing")
            missed.append(label)
            continue
        write_exact(SERVER, text.replace(old, new, 1), newline)
        try:
            code, output = run_probe()
        finally:
            SERVER.write_bytes(original)
        if code == 0:
            print(f"MISSED {label}: the probe still passed")
            missed.append(label)
            continue
        names = named_failures(output)
        if not names:
            print(f"UNNAMED {label}: the probe failed without naming a rule")
            unnamed.append(label)
        elif not any(expect in n for n in names):
            print(f"MISSED {label}: probe failed, but not on {expect!r}\n         -> {names}")
            missed.append(label)
        else:
            print(f"caught {label}\n         -> " + next(n for n in names if expect in n))

    if SERVER.read_bytes() != original:
        print(f"NOT RESTORED {SERVER}")
        return 1
    print("server restored byte-for-byte")

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
