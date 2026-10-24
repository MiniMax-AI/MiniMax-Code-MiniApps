"""Mutation control for verify-pr15-fixes.mjs.

Each mutation reintroduces exactly one bug the probe is supposed to catch. The probe must FAIL
every time, it must fail **on the assertion that owns the bug** -- a probe that fails for some
other reason has not shown that the rule is being tested -- and the file must come back
byte-for-byte identical afterwards. A mutation that the probe still passes means the assertion was
tautological.
"""
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
SERVER = ROOT / "miniapp" / "node" / "server.mjs"
CLIENT = ROOT / "miniapp" / "client" / "index.html"
PROBE = HERE / "verify-pr15-fixes.mjs"

# Each entry is (label, file, text to replace, what replaces it, the assertion that owns the bug).
# The last field is not decoration: a control that only asks "did the probe fail" is satisfied by a
# probe that fails for a reason nobody asked about, and the probe here fails on several assertions
# at once more than once. So the failure has to NAME the rule.
MUTATIONS = [
    (
        # Only the "offered" half of the original label is still observable. The count is built
        # from the identity table over the lineage and no longer reads the catalog at all, so a
        # catalog entry cannot reach it — that is pinned by its own assertion in
        # verify-generations.mjs, not by this one.
        "server: offer the whole catalog again, orphan pick included",
        SERVER,
        "  const generations = (Array.isArray(input.generations) ? input.generations : [])\n"
        "    .filter((entry) => !orphanFiles.has(entry.fileName))\n"
        "    .map((entry) => ({ ...entry, logicalMessageCount: logicalPerGeneration.get(entry.generation) ?? 0 }));",
        "  const generations = (Array.isArray(input.generations) ? input.generations : [])\n"
        "    .map((entry) => ({ ...entry, logicalMessageCount: logicalPerGeneration.get(entry.generation) ?? 0 }));",
        "the picker never offers the forked generation",
    ),
    (
        "server: match orphans by generation number instead of file name",
        SERVER,
        "  const orphanFiles = new Set(orphans.map((orphan) => orphan.fileName));",
        "  const orphanFiles = new Set(orphans.map((orphan) => String(orphan.generation)));",
        # This one is caught by the picker assertion rather than by the by-file rule: the set now
        # carries generation numbers, so the filter — which still compares file names — no longer
        # recognises the fork, and the picker offers it. The by-file rule itself needs both halves
        # changed at once, which is what the last mutation in this list does.
        "the picker never offers the forked generation",
    ),
    (
        "server: truncation fires on any read that fell short of the file",
        SERVER,
        "  return size > limit;",
        "  return size >= limit - 1;",
        "a file exactly at the cap is not",
    ),
    (
        "server: truncation fires on any read that fell short of the file (strict)",
        SERVER,
        "  return size > limit;",
        "  return size !== limit;",
        "the reported file is not truncation",
    ),
    (
        # The verdict now lives where the parse result is built rather than at the point of
        # use, because a cache hit has to carry it too — otherwise a hit would silently report
        # an untruncated file that the read that populated it had cut short.
        "server: the route stops using the tested helper",
        SERVER,
        "truncated: truncatedByCap(head.size, limit),",
        "truncated: head.read < head.size,",
        "the route actually calls the tested helper",
    ),
    (
        "server: catalog-recorded size as the read limit again",
        SERVER,
        "      const limit = MAX_MESSAGE_BYTES;",
        "      const limit = Math.min(entry.sizeBytes, identity.catalogBytes ?? MAX_MESSAGE_BYTES, MAX_MESSAGE_BYTES);",
        "no catalog-recorded size is used as a read limit any more",
    ),
    (
        "server: probe reads a truncated head budget again",
        SERVER,
        "const head = await readHead(filePath, GENERATION_PROBE_BYTES);",
        "const head = await readHead(filePath, 512);",
        "the probe reads a fixed head, not a catalog-derived budget",
    ),
    (
        "server: stop sending the cap to the page",
        SERVER,
        "      maxMessageBytes: MAX_MESSAGE_BYTES,\n",
        "",
        "the server sends the cap it applied",
    ),
    (
        # The by-file rule is a two-part thing — the orphan set has to carry file names, and the
        # filter has to compare file names — and either half alone leaves the counter-example
        # standing: a set of generation numbers is not compared against anything, and a filter
        # that compares generations against a set of file names removes nothing. So this mutation
        # changes the half that can be changed on its own: the filter now also drops a generation
        # that an orphan record NAMES BY NUMBER, and the counter-example — an orphan whose record
        # says generation 2 while naming a different file — loses generation 2 with it.
        "server: a generation an orphan names by number is dropped as well",
        SERVER,
        "    .filter((entry) => !orphanFiles.has(entry.fileName))\n",
        "    .filter((entry) => !orphanFiles.has(entry.fileName)\n"
        "      && !orphans.some((orphan) => String(orphan.generation) === String(entry.generation)))\n",
        "orphans are matched by file, not by generation number",
    ),
    (
        "client: hardcode the number instead of rendering the cap",
        CLIENT,
        "          dom.footerTruncated.textContent = '文件过大，仅显示前 ' + formatBytes(session.maxMessageBytes) + '。';",
        "          dom.footerTruncated.textContent = '文件过大，仅显示前 8 MB。';",
        "no hardcoded 8 MB survives in the markup",
    ),
    (
        # The footer is not the only place a size can be written down, and the rule is not about one
        # string — it is about a number of its own standing where the page should be formatting the
        # number it was sent. This one puts the same hardcoded cap in the session-volume line, so
        # the assertion has to fire ON ITS OWN: the footer mutation above breaks a second
        # assertion with it, and a control that only ever broke that one would never have asked
        # whether this assertion can fail by itself.
        "client: hardcode a size in the session-volume line too",
        CLIENT,
        "            '会话体积 ' + formatBytes(state.payload.session ? state.payload.session.sizeBytes : null)",
        "            '会话体积 8 MB'",
        "no hardcoded 8 MB survives in the markup",
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


def failure_names(output):
    """The assertions the probe named, in the order it named them.

    The probe prints one `  - <name>` line per failed assertion. Two of the two kinds of check
    print differently — an `assert` prints the name alone, a `check` prints the name and then what
    it got and what it wanted — so the name is the START of the line, and that is what is matched.

    A run that produced no output contains no name, so a probe that crashed cannot be read as a
    catch — which is why the name is the verdict here rather than the exit code.
    """
    names = []
    for line in output.splitlines():
        stripped = line.strip()
        if stripped.startswith("- "):
            names.append(stripped[2:].strip())
    return names


def named(names, expect):
    """Whether the probe named this rule. The name may carry what it got and what it wanted."""
    return any(name.startswith(expect) for name in names)


def main():
    code, output = run_probe()
    if code != 0:
        print("baseline probe does not pass; fix that first")
        print(output)
        return 1
    print("baseline clean")

    originals = {path: path.read_bytes() for path in {m[1] for m in MUTATIONS}}
    missed = []
    for label, path, old, new, expect in MUTATIONS:
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
        names = failure_names(output)
        if code == 0:
            print(f"MISSED {label}: the probe still passed")
            missed.append(label)
        elif not named(names, expect):
            print(f"MISSED {label}: the probe failed, but not on 「{expect}」")
            print("         it failed on: " + ("; ".join(names) if names else "(nothing was named)"))
            missed.append(label)
        else:
            print(f"caught {label}\n         -> {expect}")

    for path, data in originals.items():
        if path.read_bytes() != data:
            print(f"NOT RESTORED {path}")
            return 1
    print("all files restored byte-for-byte")

    if missed:
        print(f"\n{len(missed)} mutation(s) got through")
        return 1
    print(f"\nall {len(MUTATIONS)} mutations caught, each by name")
    return 0


if __name__ == "__main__":
    sys.exit(main())
