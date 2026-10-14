"""Mutation controls for verify-review16.mjs.

Each entry below puts one of PR #16's findings back into the shipped file and requires the guard
to report it by name before the file is restored byte for byte. A mutation reported as survived
means the guard it exercised is not testing anything, and the fix is the guard, never this list.

Nothing here needs a network, a service, or a specific machine's paths.
"""
import atexit
import io
import os
import re
import signal
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
GUARD = os.path.join(HERE, "verify-review16.mjs")

MUTATIONS = [
    # ---- 1. the harness cannot find Python again, or hides why ----
    ("the harness goes back to a single hardcoded interpreter",
     "const PYTHON_CANDIDATES = [process.env.PYTHON, 'python3', 'python'].filter(Boolean);",
     "const PYTHON_CANDIDATES = ['python'];",
     "the harness looks for more than one Python, and honours PYTHON first"),

    ("PYTHON is ignored",
     "const PYTHON_CANDIDATES = [process.env.PYTHON, 'python3', 'python'].filter(Boolean);",
     "const PYTHON_CANDIDATES = ['python3', 'python'];",
     "the harness looks for more than one Python, and honours PYTHON first"),

    ("python3 is dropped, leaving macOS and most Linux images with nothing",
     "const PYTHON_CANDIDATES = [process.env.PYTHON, 'python3', 'python'].filter(Boolean);",
     "const PYTHON_CANDIDATES = [process.env.PYTHON, 'python'];",
     "the harness looks for more than one Python, and honours PYTHON first"),

    # The silent half. A spawn that never started has no stdout and no stderr, so dropping r.error
    # from the summary reproduces exactly the reported symptom: 19/34 and no stated reason.
    ("a spawn that never started is reported as a blank line again",
     "r.error ? r.error.message : tail",
     "tail",
     "a spawn that never started is reported by name, not swallowed"),

    ("an interpreter failure counts as a pass",
     "const ok = r.status === 0 && !r.error;",
     "const ok = r.status === 0;",
     "a spawn that never started is reported by name, not swallowed"),

    ("having no interpreter at all is silently skipped",
     "results.push({ name, ok: false, ms: 0, tail: `no Python interpreter found; tried ${PYTHON_CANDIDATES.join(', ')}${detail}` });",
     "results.push({ name, ok: true, ms: 0, tail: '' });",
     "no interpreter at all is a stated failure, not a silent skip"),

    ("each control probes for its own interpreter",
     "cmd = [candidate, join(HERE, name)]; break;",
     "cmd = [candidate, join(HERE, name)];",
     "one interpreter is chosen for the whole run"),

    # ---- 2. the READMEs start claiming again ----
    ("the English README goes back to three writers",
     "written from exactly four controls",
     "written from exactly three controls",
     "the withdrawn claim 「written from exactly three controls」 is not back in README.md"),

    ("the English README claims anomaly leaves the kind array alone",
     "**The anomaly filter is the one cut-across control that also rewrites the kind array**",
     "**Neither rewrites the kind array**",
     "the withdrawn claim 「Neither rewrites the kind array」 is not back in README.md"),

    ("the Chinese README goes back to three writers",
     "只由四个控件写入",
     "只由三个控件写入",
     "the withdrawn claim 「只由三个控件写入」 is not back in README.zh-CN.md"),

    ("the Chinese README claims neither cut-across control rewrites kinds",
     "异常筛选是唯一一个会改写类型数组的横跨控件，而且是故意的",
     "两者都不改写类型数组",
     "the withdrawn claim 「两者都不改写类型数组」 is not back in README.zh-CN.md"),

    ("the README counts the controls but stops naming the code",
     "resetBaseFilters()",
     "some shared reset helper",
     "the README documents the delegation the code actually uses"),

    # ---- 3. this machine's environment starts shipping again ----
    ("the withdrawn spec comes back",
     None,
     "docs/STAGE1-SPEC.md",
     "the design document is not in the plugin directory"),

    # Re-anchored onto README.md when docs/LAYERS.md left the package. The promise is unchanged and
    # still worth guarding: a shipped file that names a document the reader does not have is a
    # dangling link, and it is the README a reader actually opens. The old anchors
    # (「否决理由就是本节…」 and the 未做清单 row) were both inside LAYERS.md.
    ("a document points at the deleted spec",
     "### Before you change this page",
     "Before changing the page, read [docs/STAGE1-SPEC.md](docs/STAGE1-SPEC.md).",
     "nothing still points at a docs/ file that does not ship"),

    (  # same reason: the 未做清单 row it used to rewrite was in LAYERS.md
     "a shell invocation and a home-directory path ship to the reader",
     "### Before you change this page",
     "### Before you change this page\n\nRun `codex exec -s read-only`; the model list is in `~/.codex/models_cache.json`.",
     "no shipped file carries /codex exec/"),

    # ---- 4. the design document comes back ----
    #
    # The four mutations this used to hold were all "put one specific line back into LAYERS.md", and
    # they are gone with the file. They are replaced, not dropped: the reviewer's complaint was that
    # the document was in the plugin directory at all — plugin.json declares no files/exclude, so the
    # whole directory installs onto every reader's machine — and that complaint outlives any one line.
    # What a later "let me put the design doc back" pass looks like is exactly this: the file reappears,
    # carrying its process snapshots, its reader-facing to-do and its decision provenance all at once.
    # So each mutation below restores the file and the guard must report that it is back.
    ("the design document is put back into the package",
     None,
     "docs/LAYERS.md",
     "the design document is not in the plugin directory"),

    ("the withdrawn spec is put back into the package",
     None,
     "docs/STAGE1-SPEC.md",
     "the design document is not in the plugin directory"),

    # And the reverse: pointing a shipped file back at it is the same defect one layer over, because
    # the README is what a reader actually opens. A dangling link in the package is the reader's copy
    # of a missing file.
    ("a shipped README points at the document that left the package",
     "### Before you change this page",
     "Before changing the page, read [docs/LAYERS.md](docs/LAYERS.md).",
     "nothing still points at a docs/ file that does not ship"),

    # ---- the same defect one layer over, in the two shipped source files ----
    #
    # The assertion those two README mutations exercise was written over the two READMEs and the two
    # source files were never added to it. Between them they carried 19 of those pointers, so the
    # check was passing over an object it did not read. A mutation that puts one back therefore has
    # to land in a source file: without these two, the assertion could have gone on green while the
    # defect was fully back, which is the hole restated as a test.
    ("the client source points at the document that left the package",
     "guess. Pinned by tests/verify-intrinsic-size.mjs.",
     "guess. See docs/LAYERS.md D15.",
     "nothing still points at a docs/ file that does not ship"),

    ("the server source points at the document that left the package",
     "// generation, so it is idempotent. Pinned by",
     "// generation, so it is idempotent — see docs/LAYERS.md D10.",
     "nothing still points at a docs/ file that does not ship"),

    # And the reason an audit of server.mjs under-reported it by two thirds: one NUL byte, in a string
    # literal that was meant to be empty. It was correct by luck and it made the whole file read as
    # binary to grep, git and diff, so nothing that scans shipped source could see past it. chr(0)
    # rather than an escape so the byte is written literally instead of being re-read as text.
    ("a NUL byte ships inside the server source",
     "const key = ids.join('');",
     "const key = ids.join('" + chr(0) + "');",
     "no shipped source file carries a NUL byte"),

    # The other half of the same defect: the numbering on its own, with no file name for the first
    # check to match against. These were labels on comments that explain themselves one line later,
    # so no reader goes looking -- which is the reason they need a check rather than an argument.
    # The layer numbers (L0-L6) are the same leak from the same missing document, so one pattern
    # covers both and the assertion names them together.
    ("a private defect number comes back into a shipped comment",
     "/* ---------------- the ledger's two ends ---------------- */",
     "/* ---------------- D44: the ledger's two ends ---------------- */",
     "no shipped file carries a private defect or layer number"),

    ("a private layer number comes back into a shipped comment",
     "       * read rather than re-measured here: the band is filters, the overview is the strip, and",
     "       * read rather than re-measured here: band is L2 and overview is L3, and",
     "no shipped file carries a private defect or layer number"),

    # ---- 5. the cache stops being released ----
    # Anchored without any line ending on purpose. The first version of these two used \r\n because
    # server.mjs is CRLF in the working tree — and that is exactly the trap: it only matched because
    # of core.autocrlf rewriting the checkout, so the anchor would have silently stopped matching
    # the moment .gitattributes pins the file to LF. Both literals below are unique in the file
    # (`parsedRows.clear();` appears once, `    clear() {` once), so neither needs the newline to
    # be unambiguous.
    ("dispose stops releasing the parsed rows",
     "    parsedRows.clear();",
     "",
     "dispose() clears the parsed-row cache too"),

    ("the parsed-row cache loses its clear()",
     "    clear() {",
     "    reset() {",
     "the parsed-row cache really does expose clear()"),

    # ---- 6. the empty state points at inert controls again ----
    ("the empty state goes back to one hint for both modes",
     "var anomalyOn = state.anomaly.rules.length > 0;",
     "var anomalyOn = false;",
     "the empty state has a branch for anomaly mode"),

    ("the anomaly branch stops naming the control that works",
     "要回到全部记录请点「清除筛选」。",
     "可以放宽类型或搜索词。",
     "the anomaly branch tells the reader to press 清除筛选"),

    ("the hint that does apply to the normal case is lost",
     "'共 ' + total + ' 条记录中没有匹配项，可以放宽类型或搜索词。'",
     "'共 ' + total + ' 条记录中没有匹配项。'",
     "the non-anomaly hint is still the one that names types and search"),

    # ---- 7. the version goes back ----
    ("the version is put back to 1.0.0",
     '"version": "1.1.0",',
     '"version": "1.0.0",',
     "the plugin version was bumped off 1.0.0"),

    # The two the reviewer actually named. The mutation above only touches plugin.json, and it was
    # the only one: the guard read plugin.json and called the rule done while both READMEs kept
    # announcing 1.0.0 to every reader who opens the plugin's front page. A rule that checks the
    # field nobody complained about is not the rule that was asked for.
    ("the English README goes back to announcing the old version",
     'Version: `1.1.0`',
     'Version: `1.0.0`',
     "the English README carries the shipped version"),

    ("the Chinese README goes back to announcing the old version",
     '版本：`1.1.0`',
     '版本：`1.0.0`',
     "the Chinese README carries the shipped version"),

    # And the next bump, which is the one that would have happened next anyway: plugin.json moves
    # on and the READMEs stay behind. Asserted as equality with plugin.json rather than as "not
    # 1.0.0", so this is the case the rule is actually for.
    ("the manifest moves on and the READMEs do not follow",
     '"version": "1.1.0",',
     '"version": "1.2.0",',
     "the English README carries the shipped version"),
]


def read(rel):
    with io.open(os.path.join(ROOT, rel), encoding="utf-8", newline="") as f:
        return f.read()


def write(rel, text):
    with io.open(os.path.join(ROOT, rel), "w", encoding="utf-8", newline="") as f:
        f.write(text)


def run_guard():
    r = subprocess.run([sys.executable and _node(), GUARD], capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    return r.returncode, (r.stdout or "") + (r.stderr or "")


# This is the widest-reaching mutation control in the repo: seven shipped files, including
# index.html, server.mjs and both READMEs. An interrupted run used to leave any of them mutated on
# disk, and the next run could not tell that from a real regression. Nothing here is allowed to
# exit without putting back exactly the bytes it found.
_pending = {}


def _restore_all():
    for rel, text in list(_pending.items()):
        try:
            write(rel, text)
        except OSError:
            pass
        _pending.pop(rel, None)
    for rel, prior in list(_pending_files.items()):
        try:
            os.remove(os.path.join(ROOT, rel))
        except OSError:
            pass
        if prior is not None:
            try:
                write(rel, prior)
            except OSError:
                pass
    _pending_files.clear()


_pending_files = {}
atexit.register(_restore_all)


def _die(signum, _frame):
    _restore_all()
    sys.exit(128 + signum)


for _sig in ("SIGINT", "SIGTERM", "SIGHUP"):
    _s = getattr(signal, _sig, None)
    if _s is not None:
        try:
            signal.signal(_s, _die)
        except (ValueError, OSError):
            pass


def _node():
    import shutil
    for name in ("node", "node.exe"):
        p = shutil.which(name)
        if p:
            return p
    return "node"


caught = 0
survived = []

for entry in MUTATIONS:
    name = entry[0]
    if entry[1] is None:
        # A file-level mutation: restore it by removing the file again afterwards.
        rel = entry[2]
        expect = entry[3]
        path = os.path.join(ROOT, rel)
        existed = os.path.exists(path)
        # Keep the real bytes, not a flag: recording bytes rather than assuming "it was absent" is
        # what makes the branch correct if a file-level mutation ever targets a file that ships.
        _prior = read(rel) if existed else None
        _pending_files[rel] = _prior
        # docs/LAYERS.md left the package, so the whole docs/ directory is gone — and creating a
        # file whose parent does not exist raises FileNotFoundError before the guard ever runs. That
        # is not a mutation surviving; it is the control crashing, which would report as "caught"
        # for the wrong reason. Make the directory, and take it away again afterwards if this run is
        # what created it.
        _made_dir = []
        parent = os.path.dirname(path)
        while parent and not os.path.isdir(parent) and parent != ROOT:
            os.makedirs(parent, exist_ok=True)
            _made_dir.append(parent)
            parent = os.path.dirname(parent)
        try:
            with io.open(path, "w", encoding="utf-8", newline="") as f:
                f.write("# reintroduced by mutate-review16.py\n")
            code, out = run_guard()
        finally:
            try:
                os.remove(path)
            except OSError:
                pass
            for d in reversed(_made_dir):
                try:
                    os.rmdir(d)
                except OSError:
                    pass
            if _prior is not None:
                write(rel, _prior)
            _pending_files.pop(rel, None)
    else:
        _, old, new, expect = entry[:4]
        replace_all = len(entry) > 4 and entry[4]
        # Which file the mutation belongs to. A single-occurrence mutation must anchor somewhere
        # it appears exactly once — an anchor that matches in several places is a guess, and a
        # guess that silently lands in the wrong file is worse than a mutation that does not run.
        target = None
        if replace_all:
            for rel in ("tests/run.mjs", "README.md", "README.zh-CN.md",
                        "miniapp/client/index.html", "miniapp/node/server.mjs",
                        ".minimax-plugin/plugin.json"):
                if old in read(rel):
                    target = rel
                    break
        else:
            for rel in ("tests/run.mjs", "README.md", "README.zh-CN.md",
                        "miniapp/client/index.html", "miniapp/node/server.mjs",
                        ".minimax-plugin/plugin.json"):
                if read(rel).count(old) == 1:
                    target = rel
                    break
        if target is None:
            print("ANCHOR DID NOT RESOLVE  %s" % name)
            survived.append(name + "  [anchor matched 0 files, or >1 and not marked all]")
            continue
        original = read(target)
        mutated = original.replace(old, new) if replace_all else original.replace(old, new, 1)
        _pending[target] = original
        try:
            write(target, mutated)
            code, out = run_guard()
        finally:
            # Restore first, then judge. Reading the verdict while the shipped file is still
            # mutated is how a restore failure gets reported as a guard failure.
            write(target, original)
            _pending.pop(target, None)
        if original != read(target):
            survived.append(name + "  [restore was not byte for byte]")
            continue

    if code != 0 and expect in out:
        print("ok   guard catches: %s" % name)
        caught += 1
    else:
        print("FAIL guard catches: %s" % name)
        if expect not in out:
            print("       the guard did not report 「%s」 by name" % expect)
        survived.append(name)

print("client restored byte for byte")
code, out = run_guard()
if code == 0:
    print("green again after restore")
else:
    print("STILL RED after restore")
    print(out)

print("")
print("%d/%d mutations caught, %d survived" % (caught, len(MUTATIONS), len(survived)))
if survived:
    print("survivors:")
    for s in survived:
        print(" - " + s)
    sys.exit(1)