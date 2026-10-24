"""Mutation control for the client's dead-function guard.

`verify-dead-code.mjs` states one property: every top-level function the inline script declares
is referenced somewhere else in that script. This control breaks it in the three ways it
actually breaks, because they are three different mistakes:

  - **A helper is added for a feature that was not built yet.** The rule and the call arrive in
    different edits; the rule lands first and the call never does. This is the common one and
    the one this rule exists for.

  - **A caller is deleted and the helper is left behind.** A branch is removed, a feature is
    retired, and nobody greps for what it used to call. `turnContextSuffix` is what this looks
    like in this file's own history.

  - **The reader is only a comment.** A name mentioned in prose looks like a reference to a
    scanner that has not stripped comments — which is how `is-reading-down` read as a live CSS
    consumer, and the reason comments are stripped before anything is counted. The mutation
    keeps the call in a comment and removes the real one, so a guard that counted comments
    would call it dead for the wrong reason and a guard that ignored the rule entirely would
    call it alive.

Each must be caught *by name*. A probe that dies on an exception names nothing, and a control
that reports that as caught is reporting a crash as if it were evidence.

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
CLIENT = ROOT / "miniapp" / "client" / "index.html"
PROBE = HERE / "verify-dead-code.mjs"

# A function with exactly one reader, so deleting the reader really does orphan it. Chosen by
# measurement, not by eye: 116 top-level functions here have a single reference, and picking
# one with two would make the mutation pass for the wrong reason — the helper would still have
# a caller and the guard would be right to call it alive.
AXIS_ICON_CALLER = "        axis.appendChild(axisIcon());"
AXIS_ICON_CALLEE = "      function axisIcon() {"

MUTATIONS = [
    (
        "a helper is added for a feature that was not built yet",
        AXIS_ICON_CALLEE,
        """      function summarizeGenerationSpread(generations) {
        return generations.length;
      }

      function axisIcon() {""",
        "every function the client declares is used by something",
    ),
    (
        "a caller is deleted and the helper is left behind",
        AXIS_ICON_CALLER,
        "        axis.appendChild(document.createTextNode(''));",
        "every function the client declares is used by something",
    ),
    (
        "the only reference to a function is left in a comment",
        AXIS_ICON_CALLER,
        "        // was: axis.appendChild(axisIcon())\n        axis.appendChild(document.createTextNode(''));",
        "every function the client declares is used by something",
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

    original = CLIENT.read_bytes()
    missed = []
    unnamed = []
    for label, old, new, expect in MUTATIONS:
        text, newline = read_exact(CLIENT)
        if old not in text:
            print(f"SKIP  {label}: anchor not found")
            missed.append(label)
            continue
        if text.count(old) != 1:
            print(f"SKIP  {label}: anchor is not unique ({text.count(old)} matches)")
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
