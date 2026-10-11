"""Mutation control for verify-pr15-fixes.mjs.

Each mutation reintroduces exactly one bug the probe is supposed to catch. The probe must FAIL
every time, and the file must come back byte-for-byte identical afterwards. A mutation that the
probe still passes means the assertion was tautological.
"""
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
SERVER = ROOT / "miniapp" / "node" / "server.mjs"
CLIENT = ROOT / "miniapp" / "client" / "index.html"
PROBE = HERE / "verify-pr15-fixes.mjs"

MUTATIONS = [
    (
        "server: list the whole catalog again (orphan counted + offered)",
        SERVER,
        "  const generations = (Array.isArray(input.generations) ? input.generations : [])\n"
        "    .filter((entry) => !orphanFiles.has(entry.fileName));",
        "  const generations = Array.isArray(input.generations) ? input.generations : [];",
    ),
    (
        "server: match orphans by generation number instead of file name",
        SERVER,
        "  const orphanFiles = new Set(orphans.map((orphan) => orphan.fileName));",
        "  const orphanFiles = new Set(orphans.map((orphan) => String(orphan.generation)));",
    ),
    (
        "server: truncation fires on any read that fell short of the file",
        SERVER,
        "  return size > limit;",
        "  return size >= limit - 1;",
    ),
    (
        "server: truncation fires on any read that fell short of the file (strict)",
        SERVER,
        "  return size > limit;",
        "  return size !== limit;",
    ),
    (
        "server: the route stops using the tested helper",
        SERVER,
        "if (truncatedByCap(head.size, limit)) truncated = true;",
        "if (head.read < head.size) truncated = true;",
    ),
    (
        "server: catalog-recorded size as the read limit again",
        SERVER,
        "      const limit = MAX_MESSAGE_BYTES;",
        "      const limit = Math.min(entry.sizeBytes, identity.catalogBytes ?? MAX_MESSAGE_BYTES, MAX_MESSAGE_BYTES);",
    ),
    (
        "server: probe reads a truncated head budget again",
        SERVER,
        "const head = await readHead(filePath, GENERATION_PROBE_BYTES);",
        "const head = await readHead(filePath, 512);",
    ),
    (
        "server: stop sending the cap to the page",
        SERVER,
        "      maxMessageBytes: MAX_MESSAGE_BYTES,\n",
        "",
    ),
    (
        "client: hardcode the number instead of rendering the cap",
        CLIENT,
        "          dom.footerTruncated.textContent = '文件过大，仅显示前 ' + formatBytes(session.maxMessageBytes) + '。';",
        "          dom.footerTruncated.textContent = '文件过大，仅显示前 8 MB。';",
    ),
]


def read_exact(path):
    """Read with every line ending normalised to \\n, and remember which style the file used.

    `Path.read_text` folds CRLF into LF and `Path.write_text` puts the platform's line ending
    back, so the usual pair silently rewrites a file's endings for the duration of a mutation.
    server.mjs is CRLF and index.html is LF here, and several client guards match CSS rules with
    a literal `\\n`, so a mutated client run would fail them for a reason that has nothing to do
    with the mutation and the report would name the wrong guard.
    """
    raw = path.read_bytes().decode("utf-8")
    return raw.replace("\r\n", "\n"), ("\r\n" if "\r\n" in raw else "\n")


def write_exact(path, text, newline):
    with open(path, "wb") as handle:
        handle.write(text.replace("\n", newline).encode("utf-8"))


def run_probe():
    result = subprocess.run(
        ["node", str(PROBE)], cwd=str(HERE), capture_output=True, text=True
    )
    return result.returncode, result.stdout + result.stderr


def main():
    code, output = run_probe()
    if code != 0:
        print("baseline probe does not pass; fix that first")
        print(output)
        return 1
    print("baseline clean")

    originals = {path: path.read_bytes() for path in {m[1] for m in MUTATIONS}}
    missed = []
    for label, path, old, new in MUTATIONS:
        text, newline = read_exact(path)
        if old not in text:
            print(f"SKIP  {label}: anchor not found in {path.name}")
            missed.append(label)
            continue
        write_exact(path, text.replace(old, new, 1), newline)
        try:
            code, output = run_probe()
        finally:
            path.write_bytes(originals[path])
        if code == 0:
            print(f"MISSED {label}: the probe still passed")
            missed.append(label)
        else:
            first = next(
                (line.strip() for line in output.splitlines() if line.strip().startswith("-")),
                "(no detail)",
            )
            print(f"caught {label}\n         -> {first}")

    for path, data in originals.items():
        if path.read_bytes() != data:
            print(f"NOT RESTORED {path}")
            return 1
    print("all files restored byte-for-byte")

    if missed:
        print(f"\n{len(missed)} mutation(s) got through")
        return 1
    print(f"\nall {len(MUTATIONS)} mutations caught")
    return 0


if __name__ == "__main__":
    sys.exit(main())