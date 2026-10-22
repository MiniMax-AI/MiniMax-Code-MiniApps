"""Mutation controls for verify-artifact-root.mjs.

Each entry below puts one of the rule's owners back the way it was before the rule existed, and
requires the guard to report it BY NAME before the file is restored byte for byte. A mutation
reported as survived means the guard it exercised is not testing anything, and the fix is the
guard, never this list.

Five owners are covered, and they are not the same kind of thing:

  - the runtime refusing a data dir inside the package at all;
  - the refusal reaching a directory UNDER the package, not just the package itself;
  - the refusal not being so broad that it turns into a refusal of a sibling whose name merely
    starts with the package's name;
  - the package ignoring the directory its artifacts would land in;
  - the shipped harnesses not handing the package over as their data dir.

Nothing here needs a network, a service, or a specific machine's paths.
"""
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
PROBE = HERE / "verify-artifact-root.mjs"

SERVER = "miniapp/node/server.mjs"
GITIGNORE = ".gitignore"
LAYERS = "tests/verify-session-layers.mjs"

MUTATIONS = [
    # ---- the runtime stops refusing ------------------------------------------------------
    (
        "the runtime stops refusing a data dir inside the package",
        SERVER,
        "  assertDataDirOutsidePlugin(context);\n",
        "",
        "the runtime refuses a data dir that is the plugin package",
    ),
    # ---- the refusal has to reach a directory under it, not only the package itself -------
    (
        "the refusal only catches the package itself, not a directory under it",
        SERVER,
        "  if (isUnderDirectory(pluginRoot, dataDir)) {",
        "  if (resolve(dataDir) === resolve(pluginRoot)) {",
        "the runtime refuses a data dir under the plugin package",
    ),
    # ---- and it must not be so broad that it refuses everything --------------------------
    (
        "the refusal is a prefix test, so a sibling of the package is refused too",
        SERVER,
        "  if (isUnderDirectory(pluginRoot, dataDir)) {",
        "  if (resolve(dataDir).startsWith(resolve(pluginRoot))) {",
        "the runtime accepts a sibling of the plugin package whose name starts with its name",
    ),
    # ---- the package ignores where its artifacts would land ------------------------------
    (
        "the package ships without ignoring the directory its artifacts would land in",
        GITIGNORE,
        "\ntrajectory-artifacts/",
        "",
        "the package ignores the directory its artifacts would land in",
    ),
    # ---- and no shipped harness hands the package over -----------------------------------
    (
        "a shipped harness hands the package to the runtime as its data dir",
        LAYERS,
        "    const port = 19400 + Math.floor(Math.random() * 400) + attempt;\n"
        "    try {\n"
        "      instance = await start({\n"
        "        pluginId: 'mmc-trajectory',\n"
        "        pluginRoot: PLUGIN_ROOT,\n"
        "        dataDir: DATA_DIR,",
        "    const port = 19400 + Math.floor(Math.random() * 400) + attempt;\n"
        "    try {\n"
        "      instance = await start({\n"
        "        pluginId: 'mmc-trajectory',\n"
        "        pluginRoot: PLUGIN_ROOT,\n"
        "        dataDir: PLUGIN_ROOT,",
        "no shipped harness hands the package to the runtime as its data dir",
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


def main():
    code, output = run_probe()
    if code != 0:
        print("baseline probe does not pass; fix that first")
        print(output)
        return 1
    print("baseline clean")

    originals = {rel: (ROOT / rel).read_bytes() for rel in (SERVER, GITIGNORE, LAYERS)}

    missed = []
    unnamed = []
    for label, rel, old, new, expected in MUTATIONS:
        target = ROOT / rel
        text, newline = read_exact(target)
        if text.count(old) != 1:
            print(f"SKIP  {label}: the anchor resolves {text.count(old)} times, expected exactly 1")
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
            write_exact(target, text, newline)
        if code == 0:
            print(f"MISSED {label}: the probe still passed")
            missed.append(label)
            continue
        if expected not in output:
            print(f"UNNAMED {label}: the probe failed without naming 「{expected}」")
            unnamed.append(label)
            continue
        first = next((line.strip() for line in output.splitlines() if line.strip().startswith("- ")), None)
        print(f"caught {label}\n         -> {first}")

    for rel, original in originals.items():
        if (ROOT / rel).read_bytes() != original:
            print(f"NOT RESTORED {rel}")
            return 1
    print("files restored byte-for-byte")

    if missed or unnamed:
        if missed:
            print(f"\n{len(missed)} mutation(s) got through")
        if unnamed:
            print(f"\n{len(unnamed)} mutation(s) failed without naming a rule")
        return 1
    print(f"\nall {len(MUTATIONS)} mutations caught, each by name")
    return 0


if __name__ == "__main__":
    sys.exit(main())
