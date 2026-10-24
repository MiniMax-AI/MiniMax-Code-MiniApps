"""Mutation control for verify-freshness.mjs.

Each mutation reintroduces exactly one bug the probe is supposed to catch, BY NAME. The first one
is the defect as it shipped: a 304 was treated as "nothing happened", so on a quiet session — where
every poll revalidates into a 304 — the warning outlived the fault that raised it while claiming it
was still retrying.

The last case is the other direction: an edit that only ADDS A COMMENT must leave the probe green.
A guard that cannot pass is as broken as one that cannot fail, and that is the only way to prove
this probe is reading behaviour rather than prose.

Every case names the rule it is about in its `expect` field, and a case counts as caught only
when the probe reported THAT rule: a probe that went red on some other assertion has not shown
that this guard owns this mutation.
"""
import json
import re
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
        "a 304 takes the warning down — this is the defect the guard exists for",
    ),
    (
        # The other half of the same layer: the list failure used to be written to a flag that
        # nothing read, so a failed session list was invisible to the reader.
        "a failed session list is recorded and never shown",
        "            noteFresh('sessions', false, freshnessReason(error));\n            renderBars();",
        "            renderBars();",
        "a failed list is visible at all — it used to write a flag nothing read",
    ),
    # ---- the count ------------------------------------------------------------------------
    (
        "recovering does not reset the count, so a past outage is remembered forever",
        "        if (ok) {\n          slot.streak = 0;\n          slot.reason = '';",
        "        if (ok) {\n          slot.reason = '';",
        "and the streak is back to zero",
    ),
    # ---- which kind of failure -------------------------------------------------------------
    (
        "a dropped connection is reported as a bad answer, which sends the reader the wrong way",
        "        if (error && typeof error.status === 'number') return 'bad_response';\n        return 'offline';",
        "        return 'bad_response';",
        "a dropped connection says so",
    ),
    # ---- the cost of the fix ---------------------------------------------------------------
    (
        "every 304 re-renders, trading a stuck warning for a ledger rebuilt every 8 seconds",
        "              if (cleared) render();",
        "              render();",
        "five more 304s on a quiet session render nothing",
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
    """The probe's verdict, stdout and stderr together.

    This probe writes its failures to stderr and its summary to stdout, so both are captured:
    a name that arrived on stderr is a name the guard reported.
    """
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

    Two formats, as in `mutate-search-endpoint.py`: `  - <name>` and `FAIL <name>`. A case is
    only caught when the rule it names is among them.
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

    original = HTML.read_bytes()
    missed = []
    unnamed = []
    for label, old, new, expect in MUTATIONS:
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
        names = reported_rules(output)
        if not names:
            print(f"UNNAMED {label}: the probe failed without naming a rule")
            unnamed.append(label)
            continue
        # The case names the rule it is about, so the probe has to name THAT rule and not some
        # other one that happened to go red in the same run: a probe that went red elsewhere has
        # not shown that this guard owns this mutation.
        if expect not in names:
            print(f"MISSED {label}: the probe named {names} instead of {expect}")
            missed.append(label)
            continue
        print(f"caught {label}\n         -> {expect}")

    # ---- the other direction ---------------------------------------------------------------
    # A note in this file must not change a single verdict. If adding prose can turn the probe
    # red, the probe is reading the prose. The marker is chosen to be absent from the probe, so
    # that "it was already there" cannot be mistaken for "it made no difference".
    text, newline = read_exact(HTML)
    anchor = "      function renderBars() {"
    note = "/* note-only-edit-marker */"
    # Bytes, not text: `Path.write_text` translates "\n" to "\r\n" on write, so restoring the
    # probe through it rewrote all 273 lines and the file came back CRLF. The shipped-file half of
    # this control already reads bytes for exactly this reason; the probe half has to as well.
    probe_bytes = PROBE.read_bytes()
    probe_text = probe_bytes.decode("utf-8")
    if anchor not in text or note in probe_text:
        print("SKIP  comment-only edit: precondition not met")
        missed.append("comment-only edit")
    else:
        PROBE.write_bytes(
            probe_text.replace(anchor, "      " + note + "\n" + anchor, 1).encode("utf-8")
        )
        try:
            code, output = run_probe()
        finally:
            PROBE.write_bytes(probe_bytes)
        if PROBE.read_bytes() != probe_bytes:
            print("NOT RESTORED %s" % PROBE)
            return 1
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
