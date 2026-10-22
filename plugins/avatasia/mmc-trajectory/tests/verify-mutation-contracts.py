"""A mutation control must judge a case by the NAME of the rule that case broke.

The rule this pins, in two sentences:

  A mutation control that gives a case its own expected rule name must decide that case by
  MEMBERSHIP -- testing the case's own name against the collection of names the guard reported --
  and must never decide it by taking ONE reported name and treating it as the rule's name.

  A control that carries no per-case expected rule name cannot say which rule fired, so it is
  reported as not using the name contract rather than failed: the contract is about how a case is
  judged, and a control that never claims ownership of a rule has nothing to judge by.

Why this is a rule and not a style: the first `- ` line a guard prints is whatever that guard
happened to fail on first. A control that takes that line and calls it "the rule" reports a case
as caught whenever the guard went red for ANY reason -- a second assertion in the same file, a
crash in an unrelated check, a stale expectation. Such a control still passes, and the number it
prints is a number that means nothing. The reviewer found exactly this in two controls; the fix
was to give every case its own expected rule name and to test that name by membership. This guard
is what stops the fix from being undone by accident, and it is a static reading of the control's
own source rather than a run of it: running every control would rewrite shipped files, and this
guard has to be able to run while a suite is in flight.

The coverage set is DERIVED, never written out: every tests/mutate-*.py in this directory is
covered, so a control added tomorrow is covered without anybody editing this file. The two files
the reviewer found are pinned by an ANCHOR below, which is a different thing: the anchor says
those two must carry the contract, so that relaxing either one -- including dropping the
expected-name field, which takes it out of the set of controls that carry it -- is reported by
name.

The set is read from this file's own directory, so a copy of this file placed somewhere with no
controls under it derives an empty set and FAILS. A guard that cannot be silenced is one that
cannot report nothing and call it clean.
"""

import ast
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent

# The coverage set is derived from the package: every mutation control that ships in this
# directory. Written out as a pattern, never as a list of names.
COVERAGE_PATTERN = "mutate-*.py"

# The anchor. These two are the controls the reviewer found deciding a case by one reported
# name. They are named here on purpose and are NOT the coverage set: the set above is derived,
# and this is the one place a file name is written down. Both must carry the name contract, so
# relaxing either one -- or dropping the expected-name field, which removes it from the set of
# controls that carry it -- is reported by name.
ANCHOR = ("mutate-search-endpoint.py", "mutate-search-segments.py")

# The rules, named once, so the output a failure carries is the same string every time.
RULE_MEMBERSHIP = "a mutation control decides a case by membership, not by one reported name"
RULE_ANCHOR = "the two reviewed mutation controls decide their cases by membership"
RULE_DERIVED = "the set of mutation controls is derived from the package and is not empty"
RULE_PARSE = "every mutation control in the package parses"
RULE_CLAIM = "a control that claims it caught cases by name judges them by membership"

# The claim itself. A control that PRINTS this is saying that it caught its cases by name, and
# that has to be true of it.
#
# It is looked for in the strings a control prints, not anywhere in its source: a comment or a
# docstring that mentions the phrase is prose, not a claim, and a rule that scanned the whole
# file would fire on the documentation of the very controls that do honour it. This is a rule
# about text, and the text it is about is the claim the control makes to whoever reads its
# output.
CLAIM_PHRASE = "each by name"

# How a control decides.
BY_MEMBERSHIP = "membership"
BY_SINGLE_NAME = "single-name"
BY_NO_NAME = "no-name"

# A slot holds the source text the control writes into a shipped file. Those are not rule names,
# and a control that tests one of them against the file it is editing is doing anchor work, not
# judging a case.
SOURCE_METHODS = ("replace", "sub", "count")


# --------------------------------------------------------------------------------------
# reading a control
# --------------------------------------------------------------------------------------

def names_in(node):
    """Every name an expression mentions."""
    return {n.id for n in ast.walk(node) if isinstance(n, ast.Name)}


def show(node):
    try:
        return ast.unparse(node)
    except Exception:  # pragma: no cover - only on an interpreter too old to unparse
        return "<expression>"


def has_call(node):
    """Whether an expression calls anything. A call is work, not a value."""
    return any(isinstance(n, ast.Call) for n in ast.walk(node))


def case_tables(tree):
    """The names that hold a list of cases: a module- or function-level list of tuples."""
    tables = {}
    for node in ast.walk(tree):
        if not isinstance(node, ast.Assign):
            continue
        value = node.value
        if not isinstance(value, ast.List) or not value.elts:
            continue
        if not all(isinstance(e, ast.Tuple) and e.elts for e in value.elts):
            continue
        for target in node.targets:
            if isinstance(target, ast.Name):
                tables.setdefault(target.id, value.elts)
    return tables


def function_params(tree):
    """The parameter names of every function defined in this file."""
    params = {}
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            params[node.name] = [a.arg for a in node.args.args]
    return params


def source_variables(tree):
    """The variables that hold the source text a control writes into a shipped file.

    The signal is the call that rewrites the file, and the comparison a control makes between
    two of its own anchors. Both are independent of how a case is judged, which is what makes
    them usable here.
    """
    source = set()
    changed = True
    while changed:
        changed = False
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) \
                    and node.func.attr in SOURCE_METHODS:
                for arg in node.args:
                    for name in names_in(arg):
                        if name not in source:
                            source.add(name)
                            changed = True
            elif isinstance(node, ast.Compare):
                for index, op in enumerate(node.ops):
                    if type(op).__name__ not in ("Eq", "NotEq"):
                        continue
                    left = names_in(node.left)
                    right = names_in(node.comparators[index])
                    if left & source and not (right & source):
                        grown = right - source
                    elif right & source and not (left & source):
                        grown = left - source
                    else:
                        continue
                    # Only a set that actually grows counts as a change. A comparison against a
                    # constant has no name on one side, and treating that as growth is a loop
                    # that never ends.
                    if grown:
                        source |= grown
                        changed = True
    return source


def carries_case_value(node, values, containers):
    """Whether an expression carries a value that came out of a case.

    A call is work, not a value: `read_exact(path)` reads the file the case is about and
    `path.read_bytes()` reads it again. A conditional or a concatenation carries the value it
    was built from, which is what `names = expect if isinstance(expect, list) else [expect]`
    does.
    """
    if isinstance(node, ast.Name):
        return node.id in values or node.id in containers
    if isinstance(node, ast.IfExp):
        return (carries_case_value(node.body, values, containers)
                or carries_case_value(node.orelse, values, containers))
    if isinstance(node, ast.BinOp):
        return (carries_case_value(node.left, values, containers)
                or carries_case_value(node.right, values, containers))
    if isinstance(node, (ast.List, ast.Tuple, ast.Set)):
        return any(carries_case_value(e, values, containers) for e in node.elts)
    if isinstance(node, ast.Subscript):
        return carries_case_value(node.value, values, containers)
    return False


def carries_source_value(node, source):
    """Whether an expression carries the source text a control writes into a shipped file."""
    if isinstance(node, ast.Name):
        return node.id in source
    if isinstance(node, ast.IfExp):
        return (carries_source_value(node.body, source)
                or carries_source_value(node.orelse, source))
    if isinstance(node, ast.BinOp):
        return (carries_source_value(node.left, source)
                or carries_source_value(node.right, source))
    if isinstance(node, (ast.List, ast.Tuple, ast.Set)):
        return any(carries_source_value(e, source) for e in node.elts)
    if isinstance(node, ast.Subscript):
        return carries_source_value(node.value, source)
    return False


def _target_names(node):
    """The names a target binds, whether it is a tuple of names or a single name."""
    if isinstance(node, ast.Tuple):
        return [t.id for t in node.elts if isinstance(t, ast.Name)]
    if isinstance(node, ast.Name):
        return [node.id]
    return []


def case_values(tree, tables, params):
    """The variables that hold a value that came out of a case.

    A case is a tuple in a table. A container is a name that holds a whole case. A case value is
    a name that holds part of one -- the label, the expected rule name, the source snippet -- or
    something computed from part of one.

    Two things are deliberately NOT case values. A value that came out of a CALL is work, not a
    case: `data = path.read_bytes()` reads the file the case is about, and `text, newline =
    read_exact(path)` reads it again. And a value computed only from the SOURCE snippet is the
    file the control is about to write, not the case it is about.
    """
    containers = set(tables)
    values = set()
    source = source_variables(tree)
    calls = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            calls.append(node)

    changed = True
    while changed:
        changed = False

        # A parameter that receives a case list is a case list, and a parameter that receives a
        # case value is a case value.
        for call in calls:
            names = params.get(call.func.id)
            if not names:
                continue
            for index, arg in enumerate(call.args):
                if index >= len(names):
                    break
                mentioned = names_in(arg)
                if names[index] in containers or names[index] in values:
                    continue
                if mentioned & containers:
                    containers.add(names[index])
                    changed = True
                elif mentioned & values and not (mentioned & source):
                    values.add(names[index])
                    changed = True

        for node in ast.walk(tree):
            # `for x in CASES:` binds a container; `for a, b in CASES:` binds two case values.
            if isinstance(node, ast.For):
                mentioned = names_in(node.iter)
                if not (mentioned & (containers | values)):
                    continue
                targets = _target_names(node.target)
                whole_case = len(targets) == 1 and not isinstance(node.target, ast.Tuple)
                if whole_case and (mentioned & containers):
                    if targets[0] not in containers:
                        containers.add(targets[0])
                        changed = True
                else:
                    for name in targets:
                        if name not in values:
                            values.add(name)
                            changed = True

            # `a, b, c = entry` and `x = entry[2]` take one case apart.
            elif isinstance(node, ast.Assign):
                builds_cases = any(
                    isinstance(comp, ast.ListComp)
                    and any(names_in(generator.iter) & containers
                            for generator in comp.generators)
                    for comp in ast.walk(node.value))
                mentioned = names_in(node.value)
                for target in node.targets:
                    for name in _target_names(target):
                        if builds_cases:
                            if name not in containers:
                                containers.add(name)
                                changed = True
                            continue
                        if name in containers or name in values:
                            continue
                        if mentioned & containers:
                            values.add(name)
                            changed = True
                        elif (mentioned & values) and not (mentioned & source) \
                                and carries_case_value(node.value, values, containers) \
                                and not carries_source_value(node.value, source):
                            values.add(name)
                            changed = True

            # `for name in expects:` walks the list a case carries.
            elif isinstance(node, ast.comprehension):
                if names_in(node.iter) & (containers | values):
                    for name in _target_names(node.target):
                        if name not in values:
                            values.add(name)
                            changed = True

    return values, source


def single_shaped(node, bindings, depth=0):
    """Whether an expression yields ONE reported name rather than a collection of them.

    The two ways a control can end up holding one name are taking the first element of a list
    and taking the first match of an iterator. Both are what the contract forbids, so both are
    recognised here.
    """
    if depth > 6:
        return False
    if isinstance(node, ast.Call):
        return isinstance(node.func, ast.Name) and node.func.id == "next"
    if isinstance(node, ast.Subscript):
        index = node.slice
        if isinstance(index, ast.Slice):
            return True
        return isinstance(index, ast.Constant) and isinstance(index.value, int)
    if isinstance(node, ast.IfExp):
        return (single_shaped(node.body, bindings, depth + 1)
                or single_shaped(node.orelse, bindings, depth + 1))
    if isinstance(node, ast.Name):
        value = bindings.get(node.id)
        if value is None:
            return False
        return single_shaped(value, bindings, depth + 1)
    return False


def collection_literal(node, bindings, depth=0):
    """Whether an expression is a collection of names rather than one name or one string."""
    if depth > 4:
        return False
    if isinstance(node, (ast.List, ast.Tuple, ast.Set)):
        return True
    if isinstance(node, (ast.ListComp, ast.SetComp, ast.GeneratorExp)):
        return True
    if isinstance(node, ast.Name):
        value = bindings.get(node.id)
        if value is None:
            return False
        return collection_literal(value, bindings, depth + 1)
    return False


def parent_map(tree):
    """Every node's parent, so a node can be read in the context it sits in."""
    parents = {}
    for node in ast.walk(tree):
        for child in ast.iter_child_nodes(node):
            parents[child] = node
    return parents


def name_tests(tree, values, bindings):
    """The tests a control makes of a value that came out of a case.

    A test is a comparison the value takes part in, or a prefix match against it. The operand is
    what the value is tested against, and that is the whole question: a collection of reported
    names, or one reported name.
    """
    parents = parent_map(tree)
    tests = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Compare):
            for index, op in enumerate(node.ops):
                kind = type(op).__name__
                if kind not in ("In", "NotIn", "Eq", "NotEq"):
                    continue
                left = names_in(node.left)
                right = names_in(node.comparators[index])
                for side, operand in ((left, node.comparators[index]),
                                      (right, node.left)):
                    hit = side & values
                    if not hit:
                        continue
                    # The side that holds the case's own value has to BE that value. A call on
                    # that side is work the control is doing, not the name it is judging by.
                    tested = node.left if side is left else node.comparators[index]
                    if has_call(tested):
                        continue
                    # What the name is tested against has to be something the guard reported. A
                    # literal is not: `"\r\n" in data` is a check on the file, not on a rule.
                    if isinstance(operand, ast.Constant):
                        continue
                    # A containment test asks whether the name is among the reported names. An
                    # equality test only counts when what it is compared against is a collection
                    # of names: comparing the name with one string is not a membership decision,
                    # and comparing it with the file the control is editing is not one either.
                    if kind in ("In", "NotIn"):
                        membership = True
                    else:
                        membership = collection_literal(operand, bindings)
                    tests.append({"kind": kind, "vars": sorted(hit), "operand": operand,
                                  "membership": membership})
        elif isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) \
                and node.func.attr in ("startswith", "endswith"):
            hit = set()
            for arg in node.args:
                hit |= names_in(arg) & values
            if not hit:
                continue
            # The collection a prefix match walks is the iterable of the comprehension the
            # match sits in, not the string being matched.
            operand = node.func.value
            walker = parents.get(node)
            while walker is not None:
                if isinstance(walker, (ast.GeneratorExp, ast.ListComp, ast.SetComp)):
                    operand = walker.generators[0].iter
                    break
                walker = parents.get(walker)
            tests.append({"kind": "Prefix", "vars": sorted(hit),
                          "operand": operand, "membership": True})
    return tests


def describes_unmarked(tree, values):
    """What a control does instead of judging its case by the rule's name."""
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) \
                and node.func.id == "next":
            return ("takes the first name the guard reported and requires one to exist; "
                    "the case names no rule of its own")
    for node in ast.walk(tree):
        if isinstance(node, ast.Subscript) and isinstance(node.slice, ast.Constant) \
                and isinstance(node.slice.value, int):
            return ("takes the first name the guard reported and carries it; "
                    "the case names no rule of its own")
    for node in ast.walk(tree):
        if not isinstance(node, ast.Compare):
            continue
        for index, op in enumerate(node.ops):
            if type(op).__name__ not in ("In", "NotIn"):
                continue
            sides = ((node.left, node.comparators[index]),
                     (node.comparators[index], node.left))
            for literal, other in sides:
                if isinstance(literal, ast.Constant) and isinstance(literal.value, str) \
                        and not (names_in(other) & values):
                    return "decides by a fixed string appearing in the guard's output"
    for node in ast.walk(tree):
        if isinstance(node, ast.Name) and node.id.lower().endswith("code"):
            return "decides by the guard's exit code alone"
    return "decides without naming the rule the case broke"


# --------------------------------------------------------------------------------------
# one control
# --------------------------------------------------------------------------------------

def claims_by_name(tree):
    """Whether the control PRINTS a claim that it caught its cases by name.

    Only the strings the control prints count. A comment or a docstring that mentions the
    phrase is prose about the control, not a claim the control makes to whoever reads its
    output, and the difference matters: a control that documents the phrase must not be
    reported as claiming it.
    """
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        if not (isinstance(node.func, ast.Name) and node.func.id == "print"):
            continue
        for argument in node.args:
            for inner in ast.walk(argument):
                if isinstance(inner, ast.Constant) and isinstance(inner.value, str):
                    if CLAIM_PHRASE in inner.value:
                        return True
    return False


def analyse(path):
    """Read one control and say how it decides a case."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    tables = case_tables(tree)
    params = function_params(tree)
    values, source = case_values(tree, tables, params)
    bindings = bindings_of(tree)
    # A value that holds the source text a control writes into a shipped file is not a rule
    # name. Testing one of those against the file the control is editing is anchor work.
    judged = values - source
    tests = name_tests(tree, judged, bindings)
    claims = claims_by_name(tree)

    single = []
    membership = []
    for test in tests:
        if single_shaped(test["operand"], bindings):
            single.append(test)
        elif test["membership"]:
            membership.append(test)

    if single:
        return {
            "file": path.name,
            "how": BY_SINGLE_NAME,
            "detail": ("the case's own expected name is compared for equality with one "
                       "reported name: " + show(single[0]["operand"])),
            "members": sorted(judged),
            "claims": claims,
        }
    if membership:
        return {
            "file": path.name,
            "how": BY_MEMBERSHIP,
            "detail": "",
            "members": sorted(judged),
            "claims": claims,
        }
    return {
        "file": path.name,
        "how": BY_NO_NAME,
        "detail": describes_unmarked(tree, judged),
        "members": sorted(judged),
        "claims": claims,
    }


def bindings_of(tree):
    """Every name and the expression it is bound to."""
    out = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name):
                    out[target.id] = node.value
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            out[node.target.id] = node.value
    return out


def derived_set():
    """The coverage set, derived from the package rather than written out."""
    return sorted(p for p in HERE.glob(COVERAGE_PATTERN) if p.is_file())


# --------------------------------------------------------------------------------------
# the guard
# --------------------------------------------------------------------------------------

def main():
    failures = []
    passed = 0

    def check(rule, ok, detail=""):
        nonlocal passed
        if ok:
            passed += 1
            print("ok   " + rule + (": " + detail if detail else ""))
            return
        failures.append((rule, detail))
        print("FAIL " + rule + (": " + detail if detail else ""))

    controls = derived_set()

    # 1. The set is derived, and it is not empty. A guard that reads nothing and reports
    #    nothing is a guard that cannot fail.
    check(RULE_DERIVED, bool(controls),
          "%d control(s) from %s" % (len(controls), COVERAGE_PATTERN))

    results = []
    unparsed = []
    for path in controls:
        try:
            results.append(analyse(path))
        except (SyntaxError, UnicodeDecodeError, ValueError) as error:
            unparsed.append("%s: %s" % (path.name, error))

    check(RULE_PARSE, not unparsed,
          "%d parsed" % len(results) if not unparsed else "; ".join(unparsed))

    by_file = {r["file"]: r for r in results}

    # 2. No control may decide a case by taking one reported name.
    singles = [r for r in results if r["how"] == BY_SINGLE_NAME]
    check(RULE_MEMBERSHIP, not singles,
          "%d of %d decide a case by one reported name" % (len(singles), len(results))
          if not singles
          else "; ".join("%s: %s" % (r["file"], r["detail"]) for r in singles))

    # 3. The anchor. The two controls the reviewer found must carry the contract.
    missing = [name for name in ANCHOR if name not in by_file
               or by_file[name]["how"] != BY_MEMBERSHIP]
    check(RULE_ANCHOR, not missing,
          ", ".join(ANCHOR) if not missing
          else "; ".join("%s: the control does not decide its cases by membership" % name
                         for name in missing))

    # 4. The claim. A control that prints that it caught its cases by name has to judge them by
    #    membership, or the sentence it prints is false. This is the rule the previous run's
    #    finding was the same shape as, applied to every control rather than to two of them.
    claimers = sorted(r["file"] for r in results if r["claims"])
    unfounded = [r for r in results if r["claims"] and r["how"] != BY_MEMBERSHIP]
    check(RULE_CLAIM, not unfounded,
          "%d control(s) claim it caught cases by name" % len(claimers)
          if not unfounded
          else "; ".join("%s: the control claims it caught cases by name but does not decide "
                         "them by membership" % r["file"] for r in unfounded))

    # The classification, which is the report this guard owes the reader.
    members = [r for r in results if r["how"] == BY_MEMBERSHIP]
    others = [r for r in results if r["how"] != BY_MEMBERSHIP]
    print("")
    print("  by membership (%d):" % len(members))
    for record in members:
        print("    " + record["file"])
    print("  not by membership (%d):" % len(others))
    for record in others:
        print("    " + record["file"] + "  " + record["detail"])
    print("  claiming to catch cases by name (%d):" % len(claimers))
    for name in claimers:
        print("    " + name)

    if failures:
        print("")
        print("  [mutation-contracts] %d failure(s):" % len(failures))
        for rule, detail in failures:
            print("    - " + rule)
            for line in detail.split("; "):
                if line:
                    print("      " + line)
        print("")
        print("[mutation-contracts] %d of %d controls decide their cases by membership"
              % (len(members), len(results)))
        return 1

    print("")
    print("[mutation-contracts] %d of %d controls decide their cases by membership"
          % (len(members), len(results)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
