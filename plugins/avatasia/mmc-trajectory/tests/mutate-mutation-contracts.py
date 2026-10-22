"""The control that proves the name contract is enforced, and that it cannot be silenced.

`verify-mutation-contracts.py` is a guard about the OTHER mutation controls: it reads each of
them and says whether a case is judged by the NAME of the rule that case broke, or by one
reported name standing in for it. A guard that cannot fail is not a guard, so this file breaks
that guard five ways and requires it to fail by name every time:

  1. the decision compares the case's own expected name with the FIRST name the guard reported;
  2. the decision drops the case's expected name and takes the first name the guard reported;
  3. the case table drops the expected-name field altogether;
  4. the set of controls the guard derives is empty;
  5. the set of controls the guard derives has been shrunk to one.

Cases 1 to 3 are the relaxations of a real control -- `mutate-search-endpoint.py`, one of the two
the reviewer found -- and they are undone byte for byte. Cases 4 and 5 are the silencing: they
run a COPY of the guard from a directory that holds fewer controls than the package does, which
is what a guard that reads a hand-written list, or one whose list has drifted, looks like from
the inside. A guard that reported an empty set as clean would pass both of them, and the two
cases are here so that it cannot.

Every case is caught BY NAME. The guard's failure lines are collected and the case's expected
rule name has to be among them: a guard that went red for some other reason has not shown that
it owns this mutation, which is the same rule this file is about.
"""

import ast
import hashlib
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
GUARD = HERE / "verify-mutation-contracts.py"
TARGET = HERE / "mutate-search-endpoint.py"

# The rules the guard reports, spelled the way it spells them.
RULE_MEMBERSHIP = "a mutation control decides a case by membership, not by one reported name"
RULE_ANCHOR = "the two reviewed mutation controls decide their cases by membership"
RULE_DERIVED = "the set of mutation controls is derived from the package and is not empty"

# The decision that is correct, and the two that are not. The case table is not touched by the
# first two: every case keeps its expected rule name, and only the decision changes.
DECISION_FROM = r"""        # The case names the rule it is about, so the probe has to name THAT rule and not some
        # other one that happened to go red in the same run: a probe that went red elsewhere has
        # not shown that this guard owns this mutation.
        if expect not in names:
            print(f"MISSED {label}: the probe named {names} instead of {expect}")
            missed.append(label)
            continue
        print(f"caught {label}\n         -> {expect}")
"""

DECISION_SINGLE = r"""        # The case names the rule it is about, so the probe has to name THAT rule and not some
        # other one that happened to go red in the same run: a probe that went red elsewhere has
        # not shown that this guard owns this mutation.
        first = names[0]
        if first != expect:
            print(f"MISSED {label}: the probe named {names} instead of {expect}")
            missed.append(label)
            continue
        print(f"caught {label}\n         -> {first}")
"""

DECISION_FIRST = r"""        # The case names the rule it is about, so the probe has to name THAT rule and not some
        # other one that happened to go red in the same run: a probe that went red elsewhere has
        # not shown that this guard owns this mutation.
        first = names[0]
        print(f"caught {label}\n         -> {first}")
"""


def read_exact(path):
    """Normalise to LF for matching, and report the file's own newline so it can be put back."""
    data = path.read_bytes()
    text = data.decode("utf-8").replace("\r\n", "\n")
    return text, ("\r\n" if b"\r\n" in data else "\n")


def write_exact(path, text, newline):
    if newline == "\r\n":
        text = text.replace("\n", "\r\n")
    path.write_bytes(text.encode("utf-8"))


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def reported_rules(output):
    """The rules the guard named.

    Two formats, as in `mutate-search-endpoint.py`: `  - <name>` and `FAIL <name>`. A case is
    only caught when the rule it names is among them.
    """
    names = []
    for line in output.splitlines():
        text = line.strip()
        if text.startswith("- "):
            names.append(text[2:].strip())
        elif text.startswith("FAIL "):
            names.append(text[5:].strip())
    return names


def run_guard(script=None, cwd=None):
    """Run the guard, or a copy of it, and report what it said."""
    command = [sys.executable, str(script if script is not None else GUARD)]
    proc = subprocess.run(
        command,
        cwd=str(cwd if cwd is not None else HERE),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    return proc.returncode, (proc.stdout or "") + (proc.stderr or "")


# --------------------------------------------------------------------------------------
# the three relaxations of a real control
# --------------------------------------------------------------------------------------

def relax_decision(text, replacement):
    """Replace the decision that judges a case, and nothing else."""
    if DECISION_FROM not in text:
        raise SystemExit("the decision this control relaxes is not in the file any more")
    return text.replace(DECISION_FROM, replacement, 1)


def drop_expected_field(text):
    """Delete the expected-name field from every case, and the decision that read it.

    The field is the fourth element of every tuple in the case table, and it is found through
    the tree rather than through a pattern: the line each one sits on is read off the parse, so
    a case whose text happens to look like another case's text cannot be mistaken for it.
    """
    tree = ast.parse(text)
    table = None
    for node in ast.walk(tree):
        if not isinstance(node, ast.Assign):
            continue
        for target in node.targets:
            if isinstance(target, ast.Name) and target.id == "MUTATIONS":
                table = node.value
    if table is None:
        raise SystemExit("the case table this control edits is not in the file any more")

    drop = set()
    for element in table.elts:
        if len(element.elts) < 4:
            raise SystemExit("a case no longer carries an expected rule name")
        field = element.elts[3]
        if field.end_lineno != field.lineno:
            raise SystemExit("an expected rule name now spans more than one line")
        drop.add(field.lineno)

    kept = [line for number, line in enumerate(text.split("\n"), 1) if number not in drop]
    out = "\n".join(kept)
    out = out.replace("for label, old, new, expect in MUTATIONS:",
                      "for label, old, new in MUTATIONS:")
    out = relax_decision(out, DECISION_FIRST)
    # The name has to be gone as a NAME, not as a word: the file's own prose says "expect".
    for node in ast.walk(ast.parse(out)):
        if isinstance(node, ast.Name) and node.id == "expect":
            raise SystemExit("the expected rule name is still read after the field was dropped")
    return out


RELAXATIONS = [
    ("the decision compares the case's expected name with the first name the guard reported",
     RULE_MEMBERSHIP,
     lambda text: relax_decision(text, DECISION_SINGLE)),
    ("the decision drops the case's expected name and takes the first name the guard reported",
     RULE_ANCHOR,
     lambda text: relax_decision(text, DECISION_FIRST)),
    ("the case table drops the expected-name field",
     RULE_ANCHOR,
     drop_expected_field),
]


# --------------------------------------------------------------------------------------
# the two silences
# --------------------------------------------------------------------------------------

def run_in_a_shorter_tree(label, expect, keep):
    """Run a COPY of the guard from a directory that holds fewer controls than the package.

    The copy is the guard's own source, unchanged. What differs is the directory it sits in, and
    that is the point: the set of controls it derives comes from where it stands, so a guard
    that read a list, or one whose list had drifted, would find fewer controls here and report
    on fewer. This case requires it to fail instead.
    """
    workspace = tempfile.mkdtemp(prefix="mutation-contracts-")
    try:
        shutil.copy(GUARD, Path(workspace) / GUARD.name)
        for name in keep:
            shutil.copy(HERE / name, Path(workspace) / name)
        code, output = run_guard(Path(workspace) / GUARD.name, cwd=workspace)
        names = reported_rules(output)
        if code == 0:
            print(f"MISSED {label}: the guard passed with {len(keep)} control(s) in reach")
            return False
        if expect not in names:
            print(f"MISSED {label}: the guard named {names} instead of {expect}")
            return False
        print(f"caught {label}\n         -> {expect}")
        return True
    finally:
        shutil.rmtree(workspace, ignore_errors=True)


def main():
    original_bytes = TARGET.read_bytes()
    original_digest = digest(TARGET)
    missed = []
    unnamed = []

    # The guard as it stands has to pass, or the cases below prove nothing.
    code, output = run_guard()
    if code != 0:
        print("the guard does not pass on the package as it stands; fix that first")
        print(output)
        return 1
    print("baseline clean")

    text, newline = read_exact(TARGET)
    for label, expect, relax in RELAXATIONS:
        relaxed = relax(text)
        if relaxed == text:
            print(f"SKIP  {label}: the relaxation changes nothing")
            missed.append(label)
            continue
        write_exact(TARGET, relaxed, newline)
        try:
            code, output = run_guard()
        finally:
            TARGET.write_bytes(original_bytes)
        if code == 0:
            print(f"MISSED {label}: the guard still passed")
            missed.append(label)
            continue
        names = reported_rules(output)
        if not names:
            print(f"UNNAMED {label}: the guard failed without naming a rule")
            unnamed.append(label)
            continue
        if expect not in names:
            print(f"MISSED {label}: the guard named {names} instead of {expect}")
            missed.append(label)
            continue
        if TARGET.name not in output:
            print(f"MISSED {label}: the guard did not name {TARGET.name}")
            missed.append(label)
            continue
        print(f"caught {label}\n         -> {expect}")

    # The guard cannot be silenced by the set it derives shrinking to nothing.
    if not run_in_a_shorter_tree(
            "the set of controls the guard derives is empty",
            RULE_DERIVED, []):
        missed.append("the set of controls the guard derives is empty")

    # Nor by the set shrinking to one control that happens to be correct.
    if not run_in_a_shorter_tree(
            "the set of controls the guard derives has been shrunk to one",
            RULE_ANCHOR, ["mutate-search-endpoint.py"]):
        missed.append("the set of controls the guard derives has been shrunk to one")

    if TARGET.read_bytes() != original_bytes:
        print(f"NOT RESTORED {TARGET}")
        return 1
    if digest(TARGET) != original_digest:
        print(f"NOT RESTORED {TARGET}: the bytes are the same file but not the same hash")
        return 1
    print("file restored byte-for-byte")

    if missed or unnamed:
        if missed:
            print(f"\n{len(missed)} mutation(s) got through")
        if unnamed:
            print(f"{len(unnamed)} mutation(s) failed without naming a rule")
        return 1
    print(f"\nall {len(RELAXATIONS) + 2} relaxations caught, each by name")
    return 0


if __name__ == "__main__":
    sys.exit(main())
