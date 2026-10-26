"""Mutation control for the owner escapes that outlived the removal of the prose contract.

WHAT THIS FILE USED TO OWN, AND WHY IT IS SMALLER NOW. Most of the escapes this file held were
escapes of the READER: the machinery that read a number out of a sentence and compared it with the
number the service declares. That reader is gone. The service's comments no longer state the number
the package used to promise a reader -- the shipped comment names the RULE and the constants it
holds, and a guard that compared a comment with a constant was asserting that a piece of prose had
not gone stale. A control that kept those cases would have been holding a rule the package no
longer has, and the cases would have failed for a reason that has nothing to do with the guard.

WHAT IS LEFT IS THE MACHINERY THE GUARD STILL USES TO OBSERVE THE SERVICE, and it is four shapes:

  * the PAGE. The guard reads the interval the page's own script hands its timer, so a page that
    hands the timer a comma expression -- or a page whose inline script does not run at all -- is a
    break the guard cannot see through. The rule that owns it says so by name.
  * the SERVICE'S OWN BINDINGS. The guard reads the service's numbers from the module it imports,
    so a declaration that is really a string, or a template literal impersonating one, is a break in
    what the guard is about to read.
  * THE COPY THE GUARD READS. The guard makes a copy of the service and imports it. A copy that
    will not import leaves the guard with nothing to compare against, so it has to say that it could
    not observe the numbers -- and it must not accuse any other rule.
  * THE GUARD'S OWN SETUP. The cache starts its sweeper when the first row is written, so a service
    that cannot start one throws in the middle of the guard's setup. A throw is a stack trace and not
    the name of a rule, so the setup is wrapped, the failure is reported BY NAME, and the guard
    stops there: without a cache there are no rows to read.

THE FOURTH ONE IS NEW IN THIS ROUND (R29-F53). The guard used to let the throw escape, so a
service that could not start its sweeper produced a stack trace instead of a rule name, and a
review that reads a stack trace cannot tell which rule was broken. The case below breaks the
sweeper's creation, and the rule that owns it is the one that has to go red -- and it is the only
one that may.

THE RULES ARE CHECKED THE WAY THE ROUNDS THAT FOUND THEM ASKED FOR: the owner has to be a
BEHAVIOUR, not a shape. The page's script is run in a sandbox and the delay comes from the timer
the page itself starts; the service's numbers come from the module's own bindings.

Each case breaks one file and one rule, and a case counts as caught only when the guard reported
THAT rule -- by name -- and nothing else. The guard has to go red by NAMING a rule: a guard that
threw, or that went red without naming anything, has not shown that it owns this break.

WHY THIS IS A SEPARATE FILE. `tests/mutate-parsed-rows.py` owns the thirty-six cases of the
cache's own behaviour, and its EXACT table is the single source of truth for which rules each of
those breaks may report. Those cases and that table are frozen: a round that changes product
behaviour would have to rewrite a table that is not its own to rewrite. A control whose table has
two owners is a table with no owner. So the escapes get their own control, and the suite runs one
more file.

A CASE IS A TUPLE, AND THAT IS NOT A MATTER OF STYLE. `tests/verify-mutation-contracts.py` reads
this file's source to decide whether it judges its cases by membership -- whether the case's own
expected rule name is tested against the collection of names the guard reported -- and it reads a
case table as a LIST OF TUPLES. A case written as a dictionary is invisible to it, and a control
the guard cannot read is a control the guard cannot hold to the contract: this file was written
with dictionaries once, and the guard reported it as judging by the exit code alone. So the cases
are tuples, and a case that needs more than one edit carries its edits in parallel lists.

TWO CASES BREAK THE GUARD ITSELF, and they are two shapes a control of this kind has to be able
to state:

  * a case can break the copy the guard reads the service's numbers from, so the guard cannot
    observe them. The guard then has to FAIL LOUDLY -- by naming the rule it could not observe --
    and it must not accuse any other rule: a number the guard could not read is not a broken
    rule. The exact set is what says so: a guard that also reported "the shipped default is
    the interval the service declares" would have accused a rule the break did not break.
  * a case can break TWO things at once, when the escape only exists in that combination. The
    mis-accusation needs the observation to have failed AND the owner to compare anyway, so the
    case breaks the copy and removes the gate, and the guard has to name the rule that says it
    accuses nothing it could not observe.
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

# Each case: what it breaks, the files it breaks, the text before and after each of them, the
# rule that owns it, the EXACT set of rules that break may report, and anything the output has to
# say.
#
# The exact set is the isolation, and it is what the frozen control's table does for the other
# forty: a guard that also reported a rule this break did not break has accused another owner,
# and a reader cannot tell which rule had actually been broken.
#
# The anchor of every edit has to occur EXACTLY once in the file it edits. A control that replaces
# the first occurrence of a string that occurs twice edits a place it did not mean to edit, and
# the case then passes or fails for a reason that has nothing to do with the rule it is about.
MUTATIONS = [
    (
        "the page hands its timer a comma expression",
        [CLIENT],
        ["        }, TRAJECTORY_POLL_INTERVAL);"],
        ["        }, (TRAJECTORY_POLL_INTERVAL, 8000000));"],
        "the poll waits as long as the client declares",
        (
            "the poll waits as long as the client declares",
            "the time limit is longer than one poll, so an open tab never loses its rows",
        ),
        (),
    ),
    (
        "a template literal impersonates the proxy's declaration while the binding is a string",
        [SERVER],
        ["\nconst PARSED_ROWS_HEAP_PER_SOURCE_BYTE = 2;\n"],
        ["\nconst annotation = `\nconst PARSED_ROWS_HEAP_PER_SOURCE_BYTE = 2;\n`;\n"
         "const PARSED_ROWS_HEAP_PER_SOURCE_BYTE = '2';\n"],
        "the heap proxy is a number the service declares",
        ("the heap proxy is a number the service declares",),
        (),
    ),
    (
        "the copy the guard reads the service's numbers from will not import",
        [PROBE],
        ["await writeFile(join(dir, 'server.mjs'), `${shipped}\\nexport { ${names.join(', ')} };\\n`);"],
        ["await writeFile(join(dir, 'server.mjs'), `${shipped}\\nexport { nonexistentBinding };\\n`);"],
        "the guard could not observe the numbers the service declares",
        ("the guard could not observe the numbers the service declares",),
        # The owners that could not be compared have to say so: an owner that held quietly is an
        # owner nobody can tell apart from one that was checked and matched.
        ("held vacuously",),
    ),
    (
        "the copy will not import and the owner compares the interval anyway",
        [
            PROBE,
            PROBE,
        ],
        [
            "await writeFile(join(dir, 'server.mjs'), `${shipped}\\nexport { ${names.join(', ')} };\\n`);",
            "holds(createParsedRowsCache(1000).sweepIntervalMs === SHIPPED_SWEEP, true, BINDINGS !== null)",
        ],
        [
            "await writeFile(join(dir, 'server.mjs'), `${shipped}\\nexport { nonexistentBinding };\\n`);",
            "holds(createParsedRowsCache(1000).sweepIntervalMs === SHIPPED_SWEEP, true, true)",
        ],
        "the guard accuses no rule it could not observe",
        (
            "the guard accuses no rule it could not observe",
            "the guard could not observe the numbers the service declares",
            "the shipped default is the interval the service declares",
        ),
        (),
    ),
    (
        "the page's inline script does not run, so the owners below cannot read what they are about",
        [CLIENT],
        ["    <script>\n      'use strict';"],
        ["    <script>\n      new ResizeObserver(() => {});\n      'use strict';"],
        "the guard could not observe the page's polling interval",
        ("the guard could not observe the page's polling interval",),
        # The owners that could not be compared have to say so: an owner that held quietly is an
        # owner nobody can tell apart from one that was checked and matched.
        ("held vacuously",),
    ),
    (
        # The sweeper is created when the first row is WRITTEN, so a service that cannot create
        # one throws inside the guard's own setup -- and a throw is a stack trace, not the name of
        # a rule. The guard wraps its setup, reports the failure BY NAME and stops there, so this
        # break has to be caught by the rule that says the setup failed, and by nothing else.
        "the sweeper is never created, so the guard's own setup throws",
        [SERVER],
        ["    sweeper = setInterval(sweep, sweepIntervalMs);"],
        ["    if (false) { sweeper = setInterval(sweep, sweepIntervalMs); }"],
        "the guard could not set up the cache it reads",
        ("the guard could not set up the cache it reads",),
        (),
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
    only caught when the rule it names is among them. A NOTE the probe printed -- the reason a
    copy would not import -- is not a rule and is not among them.
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
    for label, targets, olds, news, expect, exact, must_contain in MUTATIONS:
        edits = list(zip(targets, olds, news))
        # Every edit has to land, or the case does not run at all: a case that did not happen
        # proves nothing, and reporting it as "got through" would blame the guard for an anchor
        # that has gone stale.
        stale = None
        for target, old, new in edits:
            if target not in originals:
                originals[target] = target.read_bytes()
            text, newline = read_exact(target)
            if text.count(old) != 1:
                stale = f"anchor found {text.count(old)} times"
                break
            if old == new:
                stale = "the mutation changes nothing"
                break
        if stale is not None:
            print(f"SKIP  {label}: {stale}")
            missed.append(label)
            continue
        for target, old, new in edits:
            text, newline = read_exact(target)
            write_exact(target, text.replace(old, new, 1), newline)
        try:
            code, output = run_probe()
        finally:
            for target in {target for target, _, _ in edits}:
                target.write_bytes(originals[target])
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
        # Anything the case says the probe has to say -- the owners that could not be compared
        # have to say that they could not be compared.
        missing = [needle for needle in must_contain if needle not in output]
        if missing:
            print(f"MISSED {label}: the probe did not say {missing}")
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
