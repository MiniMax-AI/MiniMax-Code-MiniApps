"""Mutation control for verify-message-identity.mjs.

Each mutation reintroduces exactly one bug the guard is supposed to catch. The guard must FAIL
every time, and the file must come back byte-for-byte identical afterwards. A mutation the guard
still passes means the assertion was tautological; a mutation whose anchor no longer exists means
the assertion went dead, which is worse -- the runner reports those as misses too.

The four declared-trim predicates are broken one at a time. Collapsing any two of them would let
one wrong assertion stand in for another, and then we would not learn which one mattered.

Three of these anchors did not do what their label says, which is the second way this file lies.
`if (false) return false;` drops a BLOCKING guard -- the branch never runs, so nothing is rejected.
Replacing a PRECONDITION inside a function that carries on with real work does not disable that
work: `if (a === null) return false;` becomes a no-op and the comparison below still runs, so the
mutation is never observed and the anchor is reported as a live miss rather than as the mistake it
is. Anchor on the line that decides the answer, not on a line near it.
"""
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
SERVER = ROOT / "miniapp" / "node" / "server.mjs"
PROBE = HERE / "verify-message-identity.mjs"

MUTATIONS = [
    # ---- rows with no usable id must not be keyed together -------------------------
    (
        "a row with no id is keyed as null, so every unkeyed row collides with the rest",
        SERVER,
        "const id = typeof row?.message_id === 'string' && row.message_id !== '' ? row.message_id : null;",
        "const id = row?.message_id ?? null;",
    ),
    (
        "an empty-string id is treated as an identity, so two empty ids merge",
        SERVER,
        "const id = typeof row?.message_id === 'string' && row.message_id !== '' ? row.message_id : null;",
        "const id = typeof row?.message_id === 'string' ? row.message_id : null;",
    ),
    # ---- what makes a version a version -------------------------------------------
    (
        "the version fingerprint stops dropping history_artifact, so an annotated copy looks trimmed",
        SERVER,
        "  const { history_artifact: _omitted, ...rest } = row;\n  return JSON.stringify(rest);",
        "  return JSON.stringify(row);",
    ),
    (
        "the fingerprint drops message.content too, so a trim stops being a second version",
        SERVER,
        "  const { history_artifact: _omitted, ...rest } = row;\n  return JSON.stringify(rest);",
        "  const { history_artifact: _a, message: _b, ...rest } = row;\n  return JSON.stringify(rest);",
    ),
    # ---- the four declared-trim predicates, one at a time -------------------------
    (
        "predicate 1 is dropped: a role change stops being blocked",
        SERVER,
        "  if (olderRow?.message?.role !== 'toolResult' || newerRow?.message?.role !== 'toolResult') return false;",
        "  if (false) return false;",
    ),
    (
        "predicate 2 is dropped: any content change counts as a declared trim",
        SERVER,
        "  return left === right;",
        "  return true;",
    ),
    (
        "predicate 3 is dropped: any changed content passes as the runtime's placeholder",
        SERVER,
        "  if (!TOOL_RESULT_REMOVED.test(text)) return false;",
        "  if (false) return false;",
    ),
    (
        "predicate 4 is dropped: a rewrite nobody declared is still called a declared trim",
        SERVER,
        "  return newerGeneration !== null && trimmedGenerations.has(newerGeneration);",
        "  return true;",
    ),
    # ---- the two views -----------------------------------------------------------
    (
        "the whole-lineage view shows the newest version, so a trimmed result replaces the original",
        SERVER,
        "      const first = entry.versions[0];\n      occurrences.push(first.occurrences[0]);",
        "      const first = entry.versions[entry.versions.length - 1];\n      occurrences.push(first.occurrences[0]);",
    ),
    (
        "a generation view stops filtering by generation, so it shows another generation's version",
        SERVER,
        "      const hit = version.occurrences.find((o) => o.generation === generation);",
        "      const hit = version.occurrences[0];",
    ),
    # ---- the turn opener ---------------------------------------------------------
    (
        "the last prompt of a turn wins the opener, so a steer is filed as the turn's dialogue",
        SERVER,
        "    if (!openers.has(entry.turnId)) {\n      openers.set(entry.turnId, entry.id);\n      openerOccurrence.set(entry.turnId, entry.versions[0].occurrences[0]);\n    }",
        "    openers.set(entry.turnId, entry.id);\n    openerOccurrence.set(entry.turnId, entry.versions[0].occurrences[0]);",
    ),
    (
        "the opener is matched by occurrence wrapper, so no view is ever found to hold it",
        SERVER,
        "  const rows = new Set(occurrences.map((occurrence) => occurrence.row));",
        "  const rows = new Set(occurrences);",
    ),
    # ---- the numbers the payload promises ------------------------------------------
    (
        "a generation counts one message once per stored copy of it",
        SERVER,
        "    const generations = new Set();\n    for (const version of entry.versions) {\n      for (const occurrence of version.occurrences) generations.add(occurrence.generation);\n    }\n    for (const generation of generations) bump(generation);",
        "    for (const version of entry.versions) {\n      for (const occurrence of version.occurrences) bump(occurrence.generation);\n    }",
    ),
    (
        "messagesAll counts stored rows again, so one message stored twice counts twice",
        SERVER,
        "  const messagesAll = identity.stats.identities + identity.stats.unkeyed;",
        "  const messagesAll = identity.stats.occurrences + identity.stats.unkeyed;",
    ),
    (
        "the physical row count is reported as the logical one",
        SERVER,
        "  const messageRowsAll = identity.stats.occurrences + identity.stats.unkeyed;",
        "  const messageRowsAll = identity.stats.identities + identity.stats.unkeyed;",
    ),
    (
        "the picker goes back to the catalog's per-file row count",
        SERVER,
        "    .map((entry) => ({ ...entry, logicalMessageCount: logicalPerGeneration.get(entry.generation) ?? 0 }));",
        "    .map((entry) => ({ ...entry, logicalMessageCount: Number.isInteger(entry.messageCount) ? entry.messageCount : null }));",
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
        print("baseline guard does not pass; fix that first")
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
            print(f"MISSED {label}: the guard still passed")
            missed.append(label)
        else:
            first = next(
                (line.strip() for line in output.splitlines() if line.strip().startswith("FAIL")),
                None,
            )
            if first is None:
                # The guard died rather than reporting an assertion. Still a catch, but saying so
                # plainly matters: "(no detail)" reads like "not really verified".
                tail = [line.strip() for line in output.splitlines() if line.strip()]
                first = f"(the guard threw, no assertion failed) {tail[-1] if tail else '(no output)'}"
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
