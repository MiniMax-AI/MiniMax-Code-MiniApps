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
     "the withdrawn stage 1 spec is gone"),

    ("a document points at the deleted spec",
     "否决理由就是本节，不用第二份文件再存一遍。",
     "否决理由见 `docs/STAGE1-SPEC.md`。",
     "no document still points at the deleted spec"),

    ("a shell invocation and a home-directory path ship to the reader",
     "| 7 | **跨家族验证只有一条腿**",
     "| 7 | 跑 `codex exec -s read-only`，模型见 `~/.codex/models_cache.json`。**跨家族验证只有一条腿**",
     "no shipped file carries /codex exec/"),

    # ---- 4. the design document becomes a status board ----
    ("the review-count row comes back",
     "| 8 | ~~PR review 状态~~",
     "| 8 | **PR #16 reviews=0**",
     "LAYERS.md carries no process snapshot (/reviews\\s*=\\s*0/)"),

    ("a temp file's disposal is recorded as a design item",
     "| 8 | ~~PR review 状态~~",
     "| 8 | `.probe\\perf-payload.json`（34 MB 临时产物）待删 |",
     "LAYERS.md carries no process snapshot (/perf-payload/)"),

    ("the reader is handed a to-do on their own machine",
     "需要另外两把交叉核对的腿",
     "需 chli 交互式处理",
     "LAYERS.md does not hand the reader a to-do on their own machine"),

    # Every occurrence, because the invariant is bulk attribution: sweeping one citation is not the
    # failure being guarded against, sweeping them all is. `all=True` below is what says so.
    ("provenance is swept away wholesale",
     "chli 的原话",
     "原始反馈",
     "LAYERS.md keeps attributing decisions to whoever made them",
     True),

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
        # Keep the real bytes, not a flag. This branch currently only ever targets a file that was
        # already deleted, so `existed` is false and nothing is read -- but recording bytes rather
        # than assuming "it was absent" is what makes the branch correct if a second file-level
        # mutation ever targets a file that ships.
        _prior = read(rel) if existed else None
        _pending_files[rel] = _prior
        try:
            with io.open(path, "w", encoding="utf-8", newline="") as f:
                f.write("# reintroduced by mutate-review16.py\n")
            code, out = run_guard()
        finally:
            try:
                os.remove(path)
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
            for rel in ("tests/run.mjs", "README.md", "README.zh-CN.md", "docs/LAYERS.md",
                        "miniapp/client/index.html", "miniapp/node/server.mjs",
                        ".minimax-plugin/plugin.json"):
                if old in read(rel):
                    target = rel
                    break
        else:
            for rel in ("tests/run.mjs", "README.md", "README.zh-CN.md", "docs/LAYERS.md",
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