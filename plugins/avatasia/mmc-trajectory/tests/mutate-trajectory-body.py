"""Break the trajectory body serializer, one rule at a time, and require the guard to catch it
by name.

The body of a large session used to be built by ONE `JSON.stringify(payload)` call. That cost
745 MB of heap on top of the payload on this machine, and the pages that peak left behind kept
the process at 965 MB resident with an 8.4 MB live heap. The body is now serialized in pieces and
kept as bytes, and each of the seven ways back below is a rule the shipped code has to keep.

Every case names the rule it is about in its `expect` field, and a case counts as caught only
when the rule it names is among the names the guard reported. A control that takes the FIRST
reported name and calls it the rule would report a case as caught whenever the guard went red for
any reason at all — a second assertion in the same file, a crash in an unrelated check, a stale
expectation — so the number it prints would be a number that means nothing.

Anchors are multi-line and server.mjs is LF, so they are written with bare \\n and the file is
read and written as bytes, with its own line endings put back exactly.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
SERVER = ROOT / "miniapp" / "node" / "server.mjs"
PROBE = HERE / "verify-trajectory-body.mjs"

# Each entry is (title, old, new, expect).
MUTATIONS = [
    # The rule the whole change rests on: the pieces have to be the bytes JSON.stringify would
    # have produced. Dropping the comma between two elements does not change the shape of any
    # one element, so nothing else about the body notices — but the page cannot parse it, and a
    # body it cannot parse is a page that shows nothing.
    (
        "the pieces lose the comma between two elements",
        "    if (!first) {",
        "    if (first) {",
        "the chunked body is the same bytes JSON.stringify would have produced",
    ),

    # The length the socket is told about. Taking the first piece's length is what a serializer
    # that forgot to sum looks like, and the page waits for a body that ended early.
    (
        "the declared length is the first piece's length",
        "  headers['content-length'] = length;",
        "  headers['content-length'] = pieces[0].length;",
        "the declared length is the sum of the pieces, not the length of one string",
    ),

    # The budget. Enlarging it until the body fits in one piece produces exactly the right bytes
    # and exactly the peak this change was made to remove.
    (
        "the budget grows until the whole body fits in one piece",
        "const TRAJECTORY_BODY_CHUNK_BYTES = 1024 * 1024;",
        "const TRAJECTORY_BODY_CHUNK_BYTES = 64 * 1024 * 1024;",
        "the body is cut into more pieces as it grows, so no single string holds it",
    ),

    # The pieces as strings. Every character outside Latin-1 makes V8 hold a string as two bytes
    # per character, which is the whole reason the pieces are bytes: a Chinese transcript doubles.
    (
        "the pieces are handed back as strings",
        "      pieces.push(Buffer.from(current, 'utf8'));",
        "      pieces.push(current);",
        "the pieces are bytes, so the body is not held as a string",
    ),

    # The budget stops bounding a piece. The bytes are still right — the body is one piece that
    # holds everything, and the peak is back.
    (
        "the budget stops bounding a piece",
        "    if (currentBytes > 1 && currentBytes + pieceBytes > budgetBytes) {",
        "    if (false) {",
        "no piece is bigger than the budget unless it holds a single element",
    ),

    # The route goes back to one string. The helper stays correct, so every unit assertion above
    # still passes, and the memory is exactly as bad as it was before.
    (
        "the route serializes the body as one string again",
        "      body = serializeTrajectoryBody(payload);",
        "      body = JSON.stringify(payload);",
        "the route serializes the body in pieces",
    ),

    # The cache is handed a string instead of the pieces. The body on the wire is still correct,
    # because a string of the same bytes is the same bytes — and the process is holding the whole
    # body as one two-byte string again, which is the half of the change that is about memory.
    (
        "the cache is handed a string instead of the pieces",
        "      body = serializeTrajectoryBody(payload);",
        "      body = serializeTrajectoryBody(payload).map((piece) => piece.toString('utf8'));",
        "the cache keeps the pieces the serializer produced, not a string of its own",
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
        cwd=str(ROOT),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    return proc.returncode, (proc.stdout or "") + (proc.stderr or "")


def rule_name(text):
    """The name of a rule the guard reported, without the evidence a comparison carries.

    The guard reports an assertion as `<name>` and a comparison as
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
    """The rules the guard named as broken.

    Two formats: `  - <name>` for the failure list and `FAIL <name>`. A case is only caught when
    the rule it names is among them.
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
        print("baseline guard does not pass; fix that first")
        print(output)
        return 1
    print("baseline clean")

    original = SERVER.read_bytes()
    missed = []
    unnamed = []
    for label, old, new, expect in MUTATIONS:
        text, newline = read_exact(SERVER)
        if text.count(old) != 1:
            print(f"SKIP  {label}: anchor found {text.count(old)} times")
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
            print(f"MISSED {label}: the guard still passed")
            missed.append(label)
            continue
        names = reported_rules(output)
        if not names:
            print(f"UNNAMED {label}: the guard failed without naming a rule")
            unnamed.append(label)
            continue
        # The case names the rule it is about, so the guard has to name THAT rule and not some
        # other one that happened to go red in the same run: a guard that went red elsewhere has
        # not shown that this guard owns this mutation.
        if expect not in names:
            print(f"MISSED {label}: the guard named {names} instead of {expect}")
            missed.append(label)
            continue
        print(f"caught {label}\n         -> {expect}")

    if SERVER.read_bytes() != original:
        print(f"NOT RESTORED {SERVER}")
        return 1
    print("file restored byte-for-byte")

    if missed or unnamed:
        if missed:
            print(f"\n{len(missed)} mutation(s) got through")
        if unnamed:
            print(f"\n{len(unnamed)} mutation(s) failed without naming a rule")
        return 1
    print(f"\nall {len(MUTATIONS)} mutations caught, each by name")
    return 0


if __name__ == "__main__":
    sys.exit(main())
