"""Mutation control for the stylesheet's dead-declaration guard.

`verify-css.mjs` states two properties: every class selector has a consumer outside `<style>`,
and every custom property is read. This control breaks each of them in the direction that
actually happens, because the two directions are different bugs with different fixes:

  - **A rule added for something nobody built.** The rule and the markup arrive in different
    edits — the markup gets reverted, or the rule was speculative — and the rule stays. This is
    what the sweep that produced the eleven dead classes was cleaning up.

  - **A consumer removed and the rule left behind.** A feature is deleted; nobody greps the
    stylesheet, because a stylesheet is not where you go looking for what a feature used. This
    is the direction that makes dead CSS accumulate, and it is the one a guard written only as
    "no unknown rules exist" would not catch.

  - **A variable declared and never read.** Deleting `.btn-primary` orphaned
    `--mcode-primary-action-bg` and `--mcode-primary-action-text` in three theme blocks during
    this very cleanup. A class sweep cannot see that; it is the other half of the same property.

Each mutation must be caught *by name*. A probe that dies on an exception names nothing, and a
control that reports that as "caught" is reporting a crash as if it were evidence.

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
PROBE = HERE / "verify-css.mjs"

# The dead rule is inserted before this one rather than appended at the end of the block, so a
# mutation that accidentally lands outside <style> fails the guard for the right reason.
KPI_ANCHOR = "      .kpi-section {"

# The whole turn header's meta line: markup and styling both go, leaving the rule behind.
TURN_META_CONSUMER = "var meta = el('span', 'turn-meta');"

LIGHT_THEME_TAIL = "        --mcode-danger: #f73646;"

MUTATIONS = [
    (
        "a class rule is added for markup that was never built",
        KPI_ANCHOR,
        """      .btn-secondary-legacy {
        background: transparent;
        border-color: transparent;
      }

      .kpi-section {""",
        "every class selector in the stylesheet has a consumer outside it",
    ),
    (
        "the turn header loses its meta line and the rule stays behind",
        TURN_META_CONSUMER,
        "var meta = el('span');",
        "every class selector in the stylesheet has a consumer outside it",
    ),
    (
        "a custom property is declared in a theme block and never read",
        LIGHT_THEME_TAIL,
        """        --mcode-danger: #f73646;
        --mcode-never-read: #123456;""",
        "--mcode-never-read is read somewhere",
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
