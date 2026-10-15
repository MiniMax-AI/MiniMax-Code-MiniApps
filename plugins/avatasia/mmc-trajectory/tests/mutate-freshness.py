"""Mutation control for verify-freshness.mjs.

Each mutation reintroduces exactly one bug the probe is supposed to catch, BY NAME. The first one
is the defect as it shipped: a 304 was treated as "nothing happened", so on a quiet session — where
every poll revalidates into a 304 — the warning outlived the fault that raised it while claiming it
was still retrying.

The last case is the other direction: an edit that only ADDS A COMMENT must leave the probe green.
A guard that cannot pass is as broken as one that cannot fail, and that is the only way to prove
this probe is reading behaviour rather than prose.
"""
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
HTML = ROOT / "miniapp" / "client" / "index.html"
PROBE = HERE / "verify-freshness.mjs"

MUTATIONS = [
    # ---- the one that shipped ----------------------------------------------------------
    (
        "a 304 is taken as nothing having happened, so the warning outlives the fault",
        "              var cleared = noteFresh('trajectory', true, '');\n              if (state.loading) {",
        "              var cleared = false;\n              if (state.loading) {",
    ),
    (
        # The other half of the same layer: the list failure used to be written to a flag that
        # nothing read, so a failed session list was invisible to the reader.
        "a failed session list is recorded and never shown",
        "            noteFresh('sessions', false, freshnessReason(error));\n            renderBars();",
        "            renderBars();",
    ),
    # ---- the count ------------------------------------------------------------------------
    (
        "recovering does not reset the count, so a past outage is remembered forever",
        "        if (ok) {\n          slot.streak = 0;\n          slot.reason = '';",
        "        if (ok) {\n          slot.reason = '';",
    ),
    # ---- which kind of failure -------------------------------------------------------------
    (
        "a dropped connection is reported as a bad answer, which sends the reader the wrong way",
        "        if (error && typeof error.status === 'number') return 'bad_response';\n        return 'offline';",
        "        return 'bad_response';",
    ),
    # ---- the cost of the fix ---------------------------------------------------------------
    (
        "every 304 re-renders, trading a stuck warning for a ledger rebuilt every 8 seconds",
        "              if (cleared) render();",
        "              render();",
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

    original = HTML.read_bytes()
    missed = []
    unnamed = []
    for label, old, new in MUTATIONS:
        text, newline = read_exact(HTML)
        if old not in text:
            print(f"SKIP  {label}: anchor not found")
            missed.append(label)
            continue
        if old == new:
            print(f"SKIP  {label}: the mutation changes nothing")
            missed.append(label)
            continue
        write_exact(HTML, text.replace(old, new, 1), newline)
        try:
            code, output = run_probe()
        finally:
            HTML.write_bytes(original)
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

    # ---- the other direction ---------------------------------------------------------------
    # A note in this file must not change a single verdict. If adding prose can turn the probe
    # red, the probe is reading the prose. The marker is chosen to be absent from the probe, so
    # that "it was already there" cannot be mistaken for "it made no difference".
    text, newline = read_exact(HTML)
    anchor = "      function renderBars() {"
    note = "/* note-only-edit-marker */"
    probe_text = PROBE.read_text(encoding="utf-8")
    if anchor not in text or note in probe_text:
        print("SKIP  comment-only edit: precondition not met")
        missed.append("comment-only edit")
    else:
        PROBE.write_text(
            probe_text.replace(anchor, "      " + note + "\n" + anchor, 1),
            encoding="utf-8",
        )
        try:
            code, output = run_probe()
        finally:
            PROBE.write_text(probe_text, encoding="utf-8")
        if code != 0:
            print(f"MISSED comment-only edit: adding a note turned the probe red\n{output}")
            missed.append("comment-only edit")
        else:
            print("caught a comment-only note leaves every verdict unchanged")

    if HTML.read_bytes() != original:
        print(f"NOT RESTORED {HTML}")
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
