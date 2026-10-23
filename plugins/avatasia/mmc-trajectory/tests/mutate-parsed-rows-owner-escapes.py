"""Mutation control for the three owner escapes the sixteenth review round reported.

  R29-F31  the promise sentence names minutes in words the parser did not know, and the owner of
           "the two forms are the same promise" held VACUOUSLY: it could not read the words, and
           a promise nobody can check is not a promise anybody checked.
  R29-F32  the page hands its timer a comma expression -- `(TRAJECTORY_POLL_INTERVAL, 8000000)`
           -- and the owner read the characters around the name instead of the argument the timer
           is really given, so the timer was seen to wait 8000 while it waits 8000000.
  R29-F33  a template literal holding a declaration impersonated the proxy's numeric declaration
           while the binding the service really uses was the string "2".

Each case breaks one file and one rule, and a case counts as caught only when the guard reported
THAT rule -- by name -- and nothing else. The guard has to go red by NAMING a rule: a guard that
threw, or that went red without naming anything, has not shown that it owns this break.

WHY THIS IS A SEPARATE FILE. `tests/mutate-parsed-rows.py` owns the forty cases of the cache's
own behaviour, and its EXACT table is the single source of truth for which rules each of those
breaks may report. Those forty cases and that table are frozen: this round changed no product
behaviour, only the owners of three rules, so adding these three to that file would have meant
rewriting a table that is not this round's to rewrite. A control whose table has two owners is a
table with no owner. So the three escapes get their own control, and the suite runs one more
file.

The rules are checked in the way the round that found them asked for: the owner has to be a
BEHAVIOUR, not a shape. The page's script is run in a sandbox and the delay comes from the timer
the page itself starts; the service's numbers come from the module's own bindings.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
SERVER = ROOT / "miniapp" / "node" / "server.mjs"
CLIENT = ROOT / "miniapp" / "client" / "index.html"
PROBE = HERE / "verify-parsed-rows.mjs"

# Each case: what it breaks, the file it breaks, the text before and after, the rule that owns
# it, and the EXACT set of rules that break may report.
#
# The exact set is the isolation, and it is what the frozen control's table does for the other
# forty: a guard that also reported a rule this break did not break has accused another owner,
# and a reader cannot tell which rule had actually been broken.
MUTATIONS = [
    (
        "the promise sentence names minutes in words the parser did not know",
        SERVER,
        "one sweep interval after the limit — twelve and a half minutes (750000 ms) with the shipped",
        "one sweep interval after the limit — thirteen minutes (750000 ms) with the shipped",
        "the promise to a reader is the same promise in both of the forms it is written in",
        ("the promise to a reader is the same promise in both of the forms it is written in",),
    ),
    (
        "the page hands its timer a comma expression",
        CLIENT,
        "        }, TRAJECTORY_POLL_INTERVAL);",
        "        }, (TRAJECTORY_POLL_INTERVAL, 8000000));",
        "the poll waits as long as the client declares",
        (
            "the poll waits as long as the client declares",
            "the time limit is longer than one poll, so an open tab never loses its rows",
        ),
    ),
    (
        "a template literal impersonates the proxy's declaration while the binding is a string",
        SERVER,
        "\nconst PARSED_ROWS_HEAP_PER_SOURCE_BYTE = 2;\n",
        "\nconst annotation = `\nconst PARSED_ROWS_HEAP_PER_SOURCE_BYTE = 2;\n`;\n"
        "const PARSED_ROWS_HEAP_PER_SOURCE_BYTE = '2';\n",
        "the heap proxy is a number the service declares",
        ("the heap proxy is a number the service declares",),
    ),
]


def read_exact(path):
    """Normalise to LF for matching, and report the file's own newline so it can be put back.

    Matching against the raw bytes would make every multi-line anchor miss -- which the runner
    reports as a surviving mutation, so the failure looks like a dead guard rather than a
    broken anchor.
    """
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
    cut off -- and the cut is made at a `: got ` whose tail really is `<json>, want <json>`, so a
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

    Two formats, as in `mutate-parsed-rows.py`: `  - <name>` and `FAIL <name>`. A case is
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

    originals = {}
    missed = []
    unnamed = []
    for label, target, old, new, expect, exact in MUTATIONS:
        if target not in originals:
            originals[target] = target.read_bytes()
        original = originals[target]
        text, newline = read_exact(target)
        # The anchor has to be there EXACTLY once. A control that replaces the first occurrence of
        # a string that occurs twice edits a place it did not mean to edit, and the case then
        # passes or fails for a reason that has nothing to do with the rule it is about -- so the
        # count is checked here, by the control itself, instead of being counted by somebody
        # reading the source.
        if text.count(old) != 1:
            print(f"SKIP  {label}: anchor found {text.count(old)} times")
            missed.append(label)
            continue
        if old == new:
            print(f"SKIP  {label}: the mutation changes nothing")
            missed.append(label)
            continue
        write_exact(target, text.replace(old, new, 1), newline)
        try:
            code, output = run_probe()
        finally:
            target.write_bytes(original)
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
        # When the case names the exact set of rules that may go red, a guard that also reported
        # a rule this break did not break has failed the case: it accused another owner.
        if set(names) != set(exact):
            print(f"OVERREACH {label}: the probe named {sorted(set(names))} "
                  f"instead of exactly {sorted(set(exact))}")
            missed.append(label)
            continue
        print(f"caught {label}\n         -> {expect}")

    for target, original in originals.items():
        if target.read_bytes() != original:
            print(f"NOT RESTORED {target}")
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
