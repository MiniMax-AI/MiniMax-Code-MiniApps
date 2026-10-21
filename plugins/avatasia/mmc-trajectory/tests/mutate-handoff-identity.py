"""Mutation control for the session the handoff names.

The handoff reads two things asynchronously — the record's untouched message and its four bulk
fields — and the page can be showing another conversation by the time they answer. The report it
hands to the Host NAMES the session, so the session has to be the one the selected record came
from, captured before the reads and not looked up after them.

Reading it after them is what the first mutation below does, and it does it with getters rather
than with a moved line: the object handed to the markdown is captured, but its fields are read
when the markdown is built — which is after the reads have answered, and by then the page may be
showing somebody else's conversation. The getter is not how anyone writes code; it is how this
one defect is reproduced in a single edit, so the control cannot be satisfied by an
implementation that merely happens to look right.

The second mutation is the blunter half: no session at all.

Both have to be caught by the same named assertion in client-check.mjs, which runs the shipped
`handoffSelected` over a deferred raw read and moves the page while that read is in flight.
"""
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
CLIENT = ROOT / "miniapp" / "client" / "index.html"
PROBE = HERE / "client-check.mjs"

MUTATIONS = [
    (
        "the handoff reads the session off the page after its reads, so a navigation names the wrong conversation",
        "        var session = state.payload ? state.payload.session : null;",
        "        var session = { get id() { return state.payload.session.id; }, get label() { return state.payload.session.label; } };",
    ),
    (
        "the handoff names no conversation at all",
        "        var session = state.payload ? state.payload.session : null;",
        "        var session = null;",
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


def main():
    code, output = run_probe()
    if code != 0:
        print("baseline probe does not pass; fix that first")
        print(output)
        return 1
    print("baseline clean")

    original = CLIENT.read_bytes()
    missed = []
    unnamed = []
    for label, old, new in MUTATIONS:
        text, newline = read_exact(CLIENT)
        if old not in text:
            print(f"SKIP  {label}: anchor not found")
            missed.append(label)
            continue
        if old == new:
            print(f"SKIP  {label}: the mutation changes nothing")
            missed.append(label)
            continue
        write_exact(CLIENT, text.replace(old, new, 1), newline)
        try:
            code, output = run_probe()
        finally:
            CLIENT.write_bytes(original)
        if code == 0:
            print(f"MISSED {label}: the probe still passed")
            missed.append(label)
            continue
        first = next((line.strip() for line in output.splitlines() if line.strip().startswith("- ")), None)
        if first is None:
            print(f"UNNAMED {label}: the probe failed without naming a rule")
            unnamed.append(label)
        else:
            print(f"caught {label}\n         -> {first}")

    if CLIENT.read_bytes() != original:
        print(f"NOT RESTORED {CLIENT}")
        return 1
    print("file restored byte-for-byte")

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
