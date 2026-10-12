"""Mutation controls for verify-fixture.mjs.

`--check` used to be a command that could not fail: make-fixtures.mjs printed "(dry run -- pass
--record to write)" and exited 0 for every input, and `--check` was not an option at all. The
promise behind it -- that the committed fixture stays usable by the guards and free of this
machine's information -- had nothing behind it.

Each entry below puts one way of failing that promise back into the shipped file and requires
verify-fixture.mjs to report it by name before the file is restored byte for byte. A mutation
reported as survived means the guard it exercised is not testing anything, and the fix is the
guard, never this list.

Mutation A is the one worth reading twice. Disabling the branch that prints the verdict -- the
same verdict checkFixture() already computed -- left every function-level assertion green,
because --checkselftest exercises the function in-process. It survived. The guard only got teeth
once it drove the `--check` branch itself, over a real tree, and read its exit code. A property
can be computed correctly and still be invisible from every path anybody actually runs.

Nothing here needs a network, a service, or a specific machine's paths, and nothing here writes
to tests/fixtures/: the broken trees are synthesised into temp directories and deleted.
"""
import io
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
TARGET = os.path.join(ROOT, "tests", "make-fixtures.mjs")
GUARD = os.path.join(HERE, "verify-fixture.mjs")

# (label, old, new, the substring the guard must print when it catches this)
MUTATIONS = [
    # ---- the branch that reports the verdict ----
    ("--check stops reporting the verdict it computed",
     "  if (r.problems.length) {",
     "  if (false && r.problems.length) {",
     '--check exits 1 on a "leak" tree'),

    ("--check names a root other than the one it judged",
     "  console.log(`fixture root : ${checkRoot}`);",
     "  console.log(`fixture root : ${OUT_ROOT}`);",
     "--check names the tree it actually judged"),

    # ---- the individual rules ----
    ("a missing shape stops being fatal",
     "  if (absent.length) {",
     "  if (false && absent.length) {",
     '--check exits 1 on a "hole" tree'),

    ("shape drift stops being reported",
     "      if (a.join() !== b.join()) {",
     "      if (false && a.join() !== b.join()) {",
     '--check exits 1 on a "drift" tree'),

    # The structure check next to the flags check cannot be isolated, and the file says so rather
    # than inventing a mutation for it: every field shapeOf() compares is one the ten NEEDED
    # predicates read too, so any re-synthesis that changes one necessarily flips a flag as well.
    # It stays because its message names the cause -- a synth rule that stopped preserving
    # structure -- instead of the symptom.

    ("the leak scan swallows what it finds",
     "    catch (e) { problems.push(e.message); }",
     "    catch (e) { /* swallowed */ }",
     '--check exits 1 on a "leak" tree'),

    # ---- the two floors ----
    ("the session floor stops being enforced",
     "const SESSIONS_FLOOR = 6;",
     "const SESSIONS_FLOOR = 0;",
     '--check exits 1 on a "thin" tree'),

    ("the row floor stops being enforced",
     "const ROWS_FLOOR = 12;",
     "const ROWS_FLOOR = 0;",
     '--check exits 1 on a "short" tree'),

    # ---- the self-test can itself be silenced ----
    ("the self-test stops noticing its own misses",
     "    if (!passed) ok = false;",
     "    if (false && !passed) ok = false;",
     "a missed case makes --checkselftest exit non-zero"),

    ("the self-test stops failing the process",
     "  console.log(ok ? '\\ncheck self-test passed' : '\\ncheck self-test FAILED');\n  process.exit(ok ? 0 : 1);",
     "  console.log(ok ? '\\ncheck self-test passed' : '\\ncheck self-test FAILED');\n  process.exit(0);",
     "a missed case makes --checkselftest exit non-zero"),

    # ---- the writer must not grade itself ----
    ("--check and --record stop refusing to run together",
     "if (record && check) {",
     "if (false && record && check) {",
     "--check and --record refuse to run together"),
]


def read():
    with io.open(TARGET, encoding="utf-8", newline="") as f:
        return f.read()


def write(text):
    with io.open(TARGET, "w", encoding="utf-8", newline="") as f:
        f.write(text)


def node():
    for name in ("node", "node.exe"):
        p = shutil.which(name)
        if p:
            return p
    return "node"


def run_guard():
    r = subprocess.run([node(), GUARD], capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    return r.returncode, (r.stdout or "") + (r.stderr or "")


original = read()
if not original.endswith("\n"):
    print("the shipped file does not end in a newline -- refusing to run mutations")
    sys.exit(2)

# Baseline first, and it has to be green. A mutation control that starts from a file the guard
# already dislikes cannot tell its own failures from the ones it caused.
code, out = run_guard()
if code != 0:
    print("baseline verify-fixture.mjs did not pass; refusing to run mutations")
    print(out)
    sys.exit(2)

caught = 0
survived = []
drifted = []

for name, old, new, expect in MUTATIONS:
    n = original.count(old)
    if n != 1:
        # An anchor that drifted, or one that matches in several places, is a guess. Guessing is
        # how a mutation lands in the wrong line and reports a clean result.
        print("ANCHOR DID NOT RESOLVE  %s  (matched %d times)" % (name, n))
        survived.append(name + "  [anchor matched %d times, needs exactly 1]" % n)
        continue
    write(original.replace(old, new))
    code, out = run_guard()
    write(original)

    if read() != original:
        drifted.append(name + "  [restore was not byte for byte]")
        print("FAIL restore            %s" % name)
        continue
    if code != 0 and expect in out:
        print("ok   guard catches: %s" % name)
        caught += 1
    else:
        print("FAIL guard catches: %s" % name)
        if expect not in out:
            print("       the guard did not report %r by name" % expect)
        survived.append(name)

print("make-fixtures.mjs restored byte for byte")
# The one that can fail. Comparing the file against the bytes this process read at startup proves
# only that it put back what it found; running the guard again proves the file on disk is a file
# the guard still accepts. The first version of mutate-anomaly.py printed "restored" over a file
# that had been dirty before it started, and passed it every run.
code, out = run_guard()
if code == 0:
    print("guard suite green again on the restored file (this is the one that can fail)")
else:
    print("STILL RED after restore")
    print(out)
    drifted.append("the restored file does not pass the guard")

print("")
print("%d/%d mutations caught, %d survived" % (caught, len(MUTATIONS), len(survived)))
if survived:
    print("survivors:")
    for s in survived:
        print(" - " + s)
if drifted:
    print("restore problems:")
    for d in drifted:
        print(" - " + d)
sys.exit(1 if (survived or drifted) else 0)