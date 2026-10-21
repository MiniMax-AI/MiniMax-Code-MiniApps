"""Break the /api/sessions validator in the shipped source and require verify-sessions-etag.mjs to
report each way it comes back by name.

A 304 that is served when the payload has changed is the worst failure this route can have: it is
silent, it is permanent for that page, and the reader sees a session list that no longer matches
the machine. Nothing crashes and nothing is logged. So the mutations below are mostly ways of
serving a 304 that is not earned — a tag that forgot one of the values the payload is built from —
and the guard has to catch each by name rather than by noticing the count went wrong somewhere.

The one that reads like a simplification and is not: dropping `limit` from the material. The tag is
then computed over the visible slice alone, so `?limit=10` and `?limit=20` share it and a page that
asked for 20 keeps its copy while asking for 10 and is told nothing changed.

Anchors are multi-line and both shipped files are LF, so they are written with bare \\n and read
and written with newline='' — matching on normalised text while preserving the file's own endings.
No anchor may contain a line ending of its own: one did, and it stopped resolving the moment the
.gitattributes pinning LF landed.
"""
import io
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PLUGIN = os.path.dirname(HERE)
SERVER = os.path.join(PLUGIN, "miniapp", "node", "server.mjs")
CLIENT = os.path.join(PLUGIN, "miniapp", "client", "index.html")
PROBE = os.path.join(HERE, "verify-sessions-etag.mjs")

# (title, edits, expect, target)
MUTATIONS = [
    # ---- the material forgets something the payload uses ----

    # The anchors below name the loop they sit in, because the material now has two loops -- the
    # main sessions and the sub-agents -- and the two read the same columns in the same order. An
    # anchor that did not name its loop would match both, and the control would refuse to run
    # rather than guess which one it meant.
    ("a rename stops moving the tag",
     [("  for (const entry of visible) {\n"
       "    const meta = titles.get(decodeSessionIdFromDirName(basename(entry.dir)));\n"
       "    const title = meta ? String(meta.title ?? \"\") : \"\";\n",
       "  for (const entry of visible) {\n"
       "    const meta = titles.get(decodeSessionIdFromDirName(basename(entry.dir)));\n"
       "    const title = \"\";\n")],
     "a renamed session moves the tag", SERVER),

    # `kind` is what puts the sub-agent and cron badges on the rows, so a page that keeps a stale
    # tag is offering the reader a worker's session as if it were their conversation.
    ("a changed session kind stops moving the tag",
     [("  for (const entry of visible) {\n"
       "    const meta = titles.get(decodeSessionIdFromDirName(basename(entry.dir)));\n"
       "    const title = meta ? String(meta.title ?? \"\") : \"\";\n"
       "    const kind = meta ? String(meta.kind ?? \"\") : \"\";\n",
       "  for (const entry of visible) {\n"
       "    const meta = titles.get(decodeSessionIdFromDirName(basename(entry.dir)));\n"
       "    const title = meta ? String(meta.title ?? \"\") : \"\";\n"
       "    const kind = \"\";\n")],
     "a changed session kind moves the tag, even with no title", SERVER),

    # The one that looks like a simplification. Two different requests, one tag.
    ("the requested limit stops being part of the tag",
     [("  const parts = ['limit=' + limit];", "  const parts = [];")],
     "a different limit moves the tag", SERVER),

    # The separator. Without one, {"ab",""} and {"a","b"} concatenate to the same string, so two
    # The separator, and there are two ways to get this wrong rather than one. Dropping it entirely
    # merges {"ab",""} with {"a","b"}. Keeping a delimiter that a value can contain moves the same
    # collision one character along: the boundary is still forgeable from inside a field. Only a
    # representation with no ambiguity in it survives both, so there are two cases and each owns the
    # assertion that names it.
    ("the fields are concatenated with no separator at all",
     [("    parts.push(JSON.stringify([entry.dir, entry.sizeBytes, entry.lastActiveAt, title, kind, parent, tag]));\n",
       "    parts.push(\"\" + entry.dir + entry.sizeBytes + entry.lastActiveAt"
       " + title + kind + parent + tag);")],
     "a title/kind split cannot be hidden inside the separator", SERVER),

    # mtime is one of the three facts the descriptor cache keys on, and the only one that moves
    # when a session is rewritten in place without growing.
    ("a newer mtime stops moving the tag",
     [("    parts.push(JSON.stringify([entry.dir, entry.sizeBytes, entry.lastActiveAt, title, kind, parent, tag]));\n",
       "    parts.push(JSON.stringify([entry.dir, entry.sizeBytes, title, kind, parent, tag]));\n")],
     "a newer mtime moves the tag", SERVER),

    # ---- the 304 that is not earned, because it is decided too late ----
    #
    # Correct answer, wrong bill: every descriptor is built and then thrown away. The validator
    # then buys only the transfer, and the transfer was never the expensive half.

    ("the 304 is decided after the descriptors are built",
     [("    if (etagMatches(requestEtag, etag)) {\n"
       "      sendJsonBody(response, 304, '', { etag, revalidate: true });\n"
       "      return;\n"
       "    }\n\n", "")],
     "the 304 is decided before any descriptor is built", SERVER),

    # `no-store` tells the browser not to revalidate at all, which turns the whole mechanism off
    # on the client side while the route still pays to compute the tag.
    ("the list answers through the non-revalidating sender",
     [("    sendJsonBody(response, 200, body, { etag, revalidate: true });",
       "    sendJson(response, 200, JSON.parse(body));")],
     "the list no longer answers through the non-revalidating sender", SERVER),

    # A 304 with no tag leaves the client unable to send it again, so every poll after it is a
    # full body: the cost is invisible and the route looks healthy. The anchor runs past the block
    # because the trajectory route has an identical 304 line and this one has to name which.
    ("the 304 stops advertising the tag",
     [("      sendJsonBody(response, 304, '', { etag, revalidate: true });\n"
       "      return;\n"
       "    }\n\n"
       "    // Same shape as the trajectory route's cache-hit branch",
       "      sendJsonBody(response, 304, '', { revalidate: true });\n"
       "      return;\n"
       "    }\n\n"
       "    // Same shape as the trajectory route's cache-hit branch")],
     "the 304 is sent through the revalidating sender", SERVER),

    # ---- the page ----

    ("the page stops sending the list validator",
     [("          headers['If-None-Match'] = state.sessionsEtag;", "")],
     "the page sends the list validator back", CLIENT),

    # A 304 that re-renders is correct and pointless: the re-render is the cost the 304 exists to
    # avoid, and on a big list it is the larger half.
    ("a 304 re-renders the picker anyway",
     [("              var fresh = response.headers.get('etag');\n"
       "              return { changed: false, body: null, etag: fresh || state.sessionsEtag };",
       "              var fresh = response.headers.get('etag');\n"
       "              renderSessionSelect();\n"
       "              return { changed: false, body: null, etag: fresh || state.sessionsEtag };")],
     "a 304 does not re-render the picker", CLIENT),

    # Half a validator: kept, never sent. Every poll then carries no header and gets a full body.
    ("the page keeps the validator but stops sending it",
     [("        } else if (state.sessionsEtag && state.sessionsEtagFor === key) {\n"
       "          headers['If-None-Match'] = state.sessionsEtag;\n"
       "        }", "        }")],
     "the page sends the list validator back", CLIENT),

    # A refresh that revalidates the list is a refresh of half the page.
    ("a manual refresh stops dropping the list validator",
     [("        if (manual) {\n"
       "          state.sessionsEtag = '';\n"
       "          state.sessionsEtagFor = '';\n"
       "        } else if", "        if (false) {\n"
       "          state.sessionsEtag = '';\n"
       "          state.sessionsEtagFor = '';\n"
       "        } else if")],
     "a manual refresh drops the list validator", CLIENT),

    # A validator carried across a different request asks a question about a payload it is not for.
    ("the list validator stops being bound to its request key",
     [("state.sessionsEtagFor === key", "true")],
     "the list validator is bound to the request key", CLIENT),

    # The one that looks like tidying. `parent` is in the body — it is what puts 「子会话」 on the
    # row — so leaving it out of the material makes the tag constant across a change the reader
    # can see, and the 304 that follows is a statement about bytes nobody re-computed. Found by
    # review, not by a failing test: the guard was passing because every map it built varied only
    # the title and the kind, so nothing ever asked the question.
    ("the validator stops covering the parent the body sends",
     [("  for (const entry of visible) {\n"
       "    const meta = titles.get(decodeSessionIdFromDirName(basename(entry.dir)));\n"
       "    const title = meta ? String(meta.title ?? \"\") : \"\";\n"
       "    const kind = meta ? String(meta.kind ?? \"\") : \"\";\n"
       "    const parent = meta ? String(meta.parent ?? \"\") : \"\";\n",
       "  for (const entry of visible) {\n"
       "    const meta = titles.get(decodeSessionIdFromDirName(basename(entry.dir)));\n"
       "    const title = meta ? String(meta.title ?? \"\") : \"\";\n"
       "    const kind = meta ? String(meta.kind ?? \"\") : \"\";\n"
       "    const parent = \"\";\n")],
     "a changed parent moves the tag, even with the title and kind held constant", SERVER),

    # The one this round's independent pass found. The material joined its fields on a bare NUL, and
    # a SQLite TEXT column can hold a NUL: a title of "a<NUL>b" beside a kind of "c" and a title of "a"
    # beside a kind of "b<NUL>c" produced byte-identical material, so two rows a reader can tell apart
    # shared an ETag and the 304 that followed was served for a payload the caller never held.
    # `String.fromCharCode(0)` rather than an escape in the replacement, because the point of the
    # mutation is the character, not how it is spelled.
    ("the fields go back to being joined on a bare NUL",
     [("    parts.push(JSON.stringify([entry.dir, entry.sizeBytes, entry.lastActiveAt, title, kind, parent, tag]));\n",
       "    parts.push(entry.dir + \"|\" + entry.sizeBytes + \"|\" + entry.lastActiveAt"
       " + \"|\" + title + String.fromCharCode(0) + kind"
       " + String.fromCharCode(0) + parent + tag);")],
     "a separator-like character inside a value cannot merge two readable rows into one tag", SERVER),

    # The kind badge, which is the same shape of rule as the parent: it is on the page, it is
    # derived from a column the runtime database holds, and a change in that column changes what
    # the row says. Leaving it out of the material makes the tag constant across a change the
    # reader can see, and the 304 that follows is a statement about bytes nobody re-computed.
    ("the validator stops covering the kind badge the body sends",
     [("  for (const entry of visible) {\n"
       "    const meta = titles.get(decodeSessionIdFromDirName(basename(entry.dir)));\n"
       "    const title = meta ? String(meta.title ?? \"\") : \"\";\n"
       "    const kind = meta ? String(meta.kind ?? \"\") : \"\";\n"
       "    const parent = meta ? String(meta.parent ?? \"\") : \"\";\n"
       "    // The kind badge the page draws is derived from the row's kind and purpose, so it is\n"
       "    // reader-visible on its own and belongs in the material for the same reason `kind` does. A\n"
       "    // runtime database that changes a session's purpose changes what the row says, and a tag that\n"
       "    // did not move would answer 304 for a body the caller never held.\n"
       "    const tag = meta ? String(sessionTagFor(meta.kind, meta.purpose) ?? \"\") : \"\";\n",
       "  for (const entry of visible) {\n"
       "    const meta = titles.get(decodeSessionIdFromDirName(basename(entry.dir)));\n"
       "    const title = meta ? String(meta.title ?? \"\") : \"\";\n"
       "    const kind = meta ? String(meta.kind ?? \"\") : \"\";\n"
       "    const parent = meta ? String(meta.parent ?? \"\") : \"\";\n"
       "    // The kind badge the page draws is derived from the row's kind and purpose, so it is\n"
       "    // reader-visible on its own and belongs in the material for the same reason `kind` does. A\n"
       "    // runtime database that changes a session's purpose changes what the row says, and a tag that\n"
       "    // did not move would answer 304 for a body the caller never held.\n"
       "    const tag = \"\";\n")],
     "a changed session purpose moves the tag, even with the title and kind held constant", SERVER),
]

ORIGINALS = {
    SERVER: io.open(SERVER, encoding="utf-8", newline="").read(),
    CLIENT: io.open(CLIENT, encoding="utf-8", newline="").read(),
}


def run():
    proc = subprocess.run(["node", PROBE], cwd=HERE,
                          capture_output=True, text=True, encoding="utf-8", errors="replace")
    return proc.returncode, proc.stdout + proc.stderr


ok = True
code, baseline = run()
base_ok = code == 0 and "0 failed" in baseline
print(("ok   " if base_ok else "FAIL ") + "baseline green")
ok = ok and base_ok

caught = []
for title, edits, expect, target in MUTATIONS:
    original = ORIGINALS[target]
    for old, new in edits:
        hits = original.count(old)
        if hits != 1:
            raise SystemExit("FAIL  anchor for %r matched %d times" % (title, hits))
        if old == new:
            raise SystemExit("FAIL  empty mutation for %r: the anchor equals its replacement" % title)
    try:
        mutated = original
        for old, new in edits:
            mutated = mutated.replace(old, new, 1)
        if mutated == original:
            raise SystemExit("FAIL  mutation for %r changed nothing" % title)
        io.open(target, "w", encoding="utf-8", newline="").write(mutated)
        during_code, during = run()
        named = expect in during
        red = during_code != 0
        # A guard that crashes is not a guard that caught anything: the rule has to be reported by
        # name, or the mutation only proved that the file no longer parses.
        print(("ok   " if (named and red) else "FAIL ") + "guard catches: " + title)
        if not named:
            print("       no assertion reported %r" % expect)
            for line in during.splitlines()[-4:]:
                print("       " + line.strip())
        elif not red:
            print("       the rule was reported but the guard still exited 0")
        caught.append(named and red)
    finally:
        io.open(target, "w", encoding="utf-8", newline="").write(ORIGINALS[target])

restored = all(io.open(path, encoding="utf-8", newline="").read() == text
               for path, text in ORIGINALS.items())
after_code, after = run()
after_ok = after_code == 0 and "0 failed" in after
print(("ok   " if restored else "FAIL ") + "both files restored byte for byte")
print(("ok   " if after_ok else "FAIL ") + "green again after restore")

sys.exit(0 if (ok and all(caught) and restored and after_ok) else 1)