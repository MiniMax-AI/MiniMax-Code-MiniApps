"""Break the two session layers -- main sessions in the conversation pick, sub-agents in the run
pick of the conversation they belong to -- in the shipped source and require the guards that own
them to report each way it comes back by name.

The picker used to list sub-agents among the conversations, flat: on the machine this was measured
on, 13 of the 20 rows were sub-agent runs of the one conversation being read, and nothing said so.
A reader comparing two entries could not tell a sub-agent run from their own work.

The fix is not a filter -- those runs were the actual content of the conversation, and hiding them
would trade a wrong list for an empty one. It is two controls: the conversation pick names the
conversation, the run pick names the run inside it. The service sends the conversations and every
run in the pool, and every run row names the conversation it hangs off.

The rules the mutations below take back, one at a time:

  * the main list holds main sessions and nothing else;
  * a main session's runs are all of them -- the list is not a window;
  * they are ordered by when each one last ran, most recently first;
  * the layer is decided by `parent_session_id` and by the chain it forms, and by nothing else;
  * a run's parent is a CONVERSATION, so a cycle is dissolved into two conversations, a run of a
    run is a conversation, and a run whose parent is not in the list is a conversation -- all
    three because a run the reader cannot reach is a run that is gone;
  * a parent that names no session is not a parent, so it is not published and the run it was
    on is a conversation;
  * the page groups its runs into a map with no prototype, so a parent id that names an
    inherited object property cannot break the grouping;
  * the pool is the whole walk, not the thirty most recent sessions;
  * the runs of a conversation that is NOT on the page travel too, because the pool is the whole
    walk and a conversation that has aged out of the twenty still has runs to offer;
  * the page follows the list: the conversation pick holds no runs, the run pick holds the runs
    of the conversation that was picked and nothing else, it is empty and disabled while the
    page follows the newest conversation, and picking a run switches to that run.

Two probes, because the rules live on two sides of the wire: the layer is the service's, and
the rows the page draws are the page's. A mutation has to be caught by one of them, by name.

The ones worth reading twice are the third and the fourth. Putting the runs in the other order
still lists every one of them, in a list that looks the same -- only the order is wrong, and
the order is the promise. And judging the layer by `purpose` instead of the parent column gets a
run with no purpose and a main session whose purpose says 「task」 exactly backwards, which is
the whole reason the parent column is the one that decides.

On the page, the failures worth catching are not strings that survived an edit: they are a run
sitting in the conversation pick, a run pick that is never empty, a run pick that lists somebody
else's runs, and a pick that does not switch. Those are read back out of a rendered picker,
not out of its source.

Anchors are multi-line and both shipped files are LF, so they are written with bare \\n and read
and written with newline='' -- matching on normalised text while preserving the file's own endings.
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
PROBES = [
    os.path.join(HERE, "verify-session-layers.mjs"),
    os.path.join(HERE, "client-check.mjs"),
]

# Each entry is (title, edits, expect) and optionally a fourth element naming the file to mutate,
# defaulting to the server.
MUTATIONS = [
    # ---- the service ----
    #
    # The defect itself: the two layers are one flat list again, and a sub-agent is back in the
    # picker wearing a conversation's clothes. The reader is back to 13 rows of somebody else's
    # runs, with nothing on screen to say which they are.
    ("a sub-agent is put back into the main list",
     [("    if (!parent) {\n      mains.push(entry);\n      continue;\n    }",
       "    mains.push(entry);\n    if (!parent) {\n      continue;\n    }")],
     "and it holds no sub-agent at all"),

    # The list is not a window, so a sub-agent that fell out of the thirty most recent sessions
    # is still a sub-agent the reader has to be able to open. The pool is the whole walk, and
    # the walk has already stat'ed every candidate, so the deeper pool costs no extra disk work.
    ("the pool is cut back to the thirty most recent sessions",
     [("    const allEntries = candidates.allEntries;\n",
       "    const allEntries = candidates.recentEntries;\n")],
     "the payload sends every run in the pool"),

    # The order, inverted. Every run is still listed, and the list still looks the same --
    # only the order is wrong, and the order is the promise: the one that ran last is the one a
    # reader is most likely to want, and it is the one this buries at the bottom.
    ("the runs are ordered the other way round",
     [("  for (const bucket of childrenByParent.values()) bucket.sort((a, b) => b.lastActiveAt - a.lastActiveAt);",
       "  for (const bucket of childrenByParent.values()) bucket.sort((a, b) => a.lastActiveAt - b.lastActiveAt);")],
     "the sub-agents of one main session are ordered most recently active first"),

    # The list is not a window, in the place where it is actually cut. This one is invisible to
    # a test of the service's own functions: the function that collects the runs is fine,
    # and the route drops them on the way out.
    ("the runs are cut down to the first three",
     [("      for (const child of bucket) childEntries.push(child);",
       "        for (const child of bucket.slice(0, 3)) childEntries.push(child);")],
     "the payload sends every run in the pool"),

    # The runs of a conversation that is not on the page. Dropping them takes away the runs of
    # a conversation the reader is reading, the moment that conversation ages out of the twenty
    # -- and the run pick of that conversation has nothing to offer.
    ("the runs of a conversation that is not on the page are dropped",
     [("    for (const bucket of layers.childrenByParent.values()) {",
       "    for (const [parentId, bucket] of layers.childrenByParent.entries()) {\n"
       "      const onThePage = visible.some((entry) => decodeSessionIdFromDirName(basename(entry.dir)) === parentId);\n"
       "      if (!onThePage) continue;")],
     "and the runs of a conversation that is not on the page are sent too"),

    # The layer judged by the wrong column. `purpose` says what a session IS -- a scheduled run, a
    # background task -- which is a different question from what it hangs off, and the two are
    # orthogonal. This mutation gets a sub-agent with no purpose and a main session whose purpose
    # says 「task」 exactly backwards, which is why the parent column is the one that decides.
    ("the layer is judged by the purpose column instead of the parent column",
     [("    const declared = typeof meta.parent === 'string' && meta.parent ? meta.parent : null;",
       "    const declared = typeof meta.purpose === 'string' && meta.purpose ? 'mvs_purpose_guessed_parent' : null;")],
     "a sub-agent whose purpose says 「sub-agent」 is still a sub-agent"),

    # The promotion step forgot the layer. The split puts a run in the run layer, and the
    # route then promotes whatever the runtime database reports as current -- so a run that
    # won that resolution was put back into the conversation list, and the same session sat
    # in both controls at once.
    ("a run that wins the current-conversation resolution is promoted into the conversation list",
     [("  const currentParent = currentMeta && typeof currentMeta.parent === 'string' && currentMeta.parent\n"
       "    ? currentMeta.parent\n"
       "    : null;",
       "  const currentParent = null;")],
     "a run that wins the current-conversation resolution is not in the conversation list"),

    # The parent that names nothing. `parent_session_id` is a foreign key into the runtime
    # database's own session table; a value that names no session there is not a parent, and
    # the page groups its runs by that value -- so publishing it puts a name on the wire that
    # no conversation in the list can answer to.
    ("a parent that names no session is published as a parent anyway",
     [("      const parentNames = parent ? Boolean(stmt.get(parent)) : false;",
       "      const parentNames = Boolean(parent);")],
     "and the map itself carries no parent that names no session"),

    # ---- the chain ----
    #
    # The parent column says a session HAS a parent. The chain says whether that parent is a
    # CONVERSATION, and a run's parent has to be one: a run of a run, or a run of a session that
    # is not in the list, is a run the reader cannot reach from either control.
    #
    # The cycle is the shape where both sessions lose. Read the column alone, each is a run of
    # the other, so neither is a conversation, the conversation list comes back with neither in
    # it, and they are in neither control.
    ("a session on a cycle is taken for a run of the session it names",
     [("      if (onCycle.has(cur)) { base = CONVERSATION; break; }",
       "      if (onCycle.has(cur)) { base = RUN; break; }")],
     "a session whose parent names it back is a conversation, not a run"),

    # A parent with a row in the runtime database and no directory in the pool. The walk never
    # asked about it, so the map does not have it, and the run of it is a run of a
    # conversation the reader cannot pick.
    ("a run whose parent is not in the list is taken for a run of it",
     [("      if (!parent || !map.has(parent)) { base = CONVERSATION; break; }",
       "      if (!parent) { base = CONVERSATION; break; }\n      if (!map.has(parent)) { base = RUN; break; }")],
     "a run whose parent is not in the list is a conversation, so that the reader can reach it"),

    # A run of a run. The two controls are one conversation and the runs of THAT one, so the
    # run of a run is a conversation the reader can pick.
    ("a run of a run is taken for a run of it",
     [("  const flip = (layer) => (layer === CONVERSATION ? RUN : CONVERSATION);",
       "  const flip = (layer) => RUN;")],
     "a run of a run is a conversation too, because the run pick shows the runs of ONE conversation"),

    # ---- the page ----
    #
    # The two picks. The conversation pick holds conversations; the run pick holds the runs of
    # the conversation that was picked. What the reader gets is read back out of a rendered
    # picker, so the failures worth catching are the ones a string would not see.
    #
    # A run in the conversation pick. That is the defect this whole feature exists for: a run
    # wearing a conversation's clothes, thirteen of twenty rows on this machine.
    ("the conversation pick lists the runs too",
     [("          var option = el('option', null, sessionOptionLabel(session, now));\n"
       "          option.value = session.id;\n"
       "          select.appendChild(option);",
       "          var option = el('option', null, sessionOptionLabel(session, now));\n"
       "          option.value = session.id;\n"
       "          select.appendChild(option);\n"
       "          var alsoRuns = childrenByParent()[session.id] || [];\n"
       "          for (var q = 0; q < alsoRuns.length; q += 1) {\n"
       "            var runOption = el('option', null, sessionOptionLabel(alsoRuns[q], now));\n"
       "            runOption.value = alsoRuns[q].id;\n"
       "            select.appendChild(runOption);\n"
       "          }")],
     "the conversation pick holds no run at all",
     CLIENT),

    # The run pick is never empty. It looks like a simplification: there is always a
    # conversation on screen, so there is always something to offer. But while the page follows
    # the newest conversation, that conversation changes under the reader.
    ("the run pick is never empty",
     [("        var owner = state.followLatest ? '' : ownerSessionId();",
       "        var owner = ownerSessionId();")],
     "the run pick is empty while the page follows the newest conversation",
     CLIENT),

    # The same empty state, but offered rather than withheld: a control that says 「pick one of
    # these」 while the conversation it would name is about to be replaced.
    ("the run pick is not disabled while the page follows",
     [("          select.disabled = true;",
       "          select.disabled = false;")],
     "and it is disabled, so there is nothing to pick",
     CLIENT),

    # The run pick lists everybody's runs. Every run is still a run and the order still looks
    # right -- but the rows are no longer about the conversation on screen, and the reader cannot
    # tell which of them are its own.
    ("the run pick lists the runs of every conversation",
     [("        var kids = childrenByParent()[owner] || [];",
       "        var kids = state.children || [];")],
     "the run pick holds every run of the conversation on screen",
     CLIENT),

    # The order, on the page this time. The service sends the runs most recently active first,
    # and a page that sorts them again can only get it wrong.
    ("the page reorders the runs it was given",
     [("        for (var j = 0; j < kids.length; j += 1) {",
       "        for (var j = kids.length - 1; j >= 0; j -= 1) {")],
     "and they keep the order the service sent",
     CLIENT),

    # The row that says 「the conversation itself」. Without it there is no way back: the reader
    # picks a run, and the conversation is gone from the controls.
    ("the run pick has no row for the conversation itself",
     [("        var self = el('option', null, '（主会话本身）');\n"
       "        self.value = '';\n"
       "        select.appendChild(self);\n",
       "")],
     "and the first option is the conversation itself",
     CLIENT),

    # The owner. A run belongs to a conversation, and the conversation pick says which one; a
    # version that keeps the run on the conversation pick shows two different answers to the
    # same question.
    ("the owner of a run is the run itself",
     [("          if (child && child.id === id && child.sessionParentId) return child.sessionParentId;",
       "          if (child && child.id === id && child.sessionParentId) return id;")],
     "the owner of a run is the conversation it hangs off",
     CLIENT),

    # The map the runs are grouped into. A plain object inherits names like '__proto__' and
    # 'constructor': they are truthy and they are not arrays, so a plain object reads one of
    # them as a group and then throws on it -- and the picker stops updating after a list
    # response that was perfectly fine.
    ("the runs are grouped into a plain object",
     [("        var grouped = Object.create(null);",
       "        var grouped = {};")],
     "a parent id that names an inherited object property does not break the grouping",
     CLIENT),

    # The press. A promise about a press is not kept by a row that merely carries the right id:
    # the page has to switch to the run the reader pressed, and this is the one that does not.
    ("picking a run does not switch to it",
     [("        selectSession(value);\n      }\n\n      /* ---------------- wiring ---------------- */",
       "        selectSession(ownerSessionId() || '');\n      }\n\n      /* ---------------- wiring ---------------- */")],
     "picking a run switches the page to that run",
     CLIENT),

    # The replaced request takes the controller with it. The controller says which request
    # to stop, and a request that has been replaced has no business stopping the one that
    # replaced it -- so the next request had nothing to abort, and the request before it
    # answered last and won.
    ("a replaced request takes the controller of the request that replaced it",
     [("            if (sessionsInflight === controller) sessionsInflight = null;\n"
       "            // A late answer must not win. Every request carries a sequence number, and only the\n",
       "            sessionsInflight = null;\n"
       "            // A late answer must not win. Every request carries a sequence number, and only the\n"),
      ("            if (sessionsInflight === controller) sessionsInflight = null;\n"
       "            // A request that has been replaced says nothing about the list on screen: the\n",
       "            sessionsInflight = null;\n"
       "            // A request that has been replaced says nothing about the list on screen: the\n")],
     "a replaced request does not take the controller of the request that replaced it",
     CLIENT),

    # The late answer is allowed to write. The sequence number is the rule that says which
    # answer may write, and a version that carries the number and ignores it is the version
    # where the older list replaces the newer one -- a picker that moves backwards under
    # the reader.
    ("a late answer is allowed to replace a newer list",
     [("            if (seq !== sessionsSeq) return false;\n"
       "            // One writer for the list's validator, on the one path that carried a body.\n",
       "            // One writer for the list's validator, on the one path that carried a body.\n"),
      ("            if (seq !== sessionsSeq) return false;\n"
       "            if (error && error.name === 'AbortError') return false;\n",
       "            if (error && error.name === 'AbortError') return false;\n")],
     "a late answer does not replace the newer list on screen",
     CLIENT),

    # The conversation pick that does not move. The run pick keeps its run, the conversation
    # pick keeps the conversation, and the two disagree about what is on screen.
    ("picking a conversation does not move the page",
     [("        selectSession(value);\n      }\n\n      /**\n       * The reader picked a run, or the conversation itself.",
       "        selectSession(state.sessionId || value);\n      }\n\n      /**\n       * The reader picked a run, or the conversation itself.")],
     "picking another conversation moves the run pick with it",
     CLIENT),

    # A 304 that arrives late. The 200 case is above: a late 200 carries a body, so a stale one
    # has something visible to overwrite. A 304 carries a VALIDATOR instead, and a stale one
    # used to write that validator before the sequence gate -- so the list on screen and the tag
    # that described it were two different things, and the next poll asked the server about the
    # old list, was told the list had not changed, and kept the new one.
    ("a late 304 writes its own validator over the newer one",
     [("              var fresh = response.headers.get('etag');\n"
       "              return { changed: false, body: null, etag: fresh || state.sessionsEtag };",
       "              var fresh = response.headers.get('etag');\n"
       "              if (fresh) state.sessionsEtag = fresh;\n"
       "              state.sessionsEtagFor = key;\n"
       "              return { changed: false, body: null, etag: state.sessionsEtag };")],
     "a late 304 does not overwrite the validator the newer answer installed",
     CLIENT),

    # The manual refresh. The reader asked for the list again, so the request must not claim to
    # already have it -- otherwise the server answers 304 and the reader watches nothing change.
    ("a manual refresh keeps the validator it was asked to drop",
     [("        if (manual) {\n"
       "          state.sessionsEtag = '';\n"
       "          state.sessionsEtagFor = '';\n"
       "        } else if (state.sessionsEtag && state.sessionsEtagFor === key) {",
       "        if (false) {\n"
       "          state.sessionsEtag = '';\n"
       "          state.sessionsEtagFor = '';\n"
       "        } else if (state.sessionsEtag && state.sessionsEtagFor === key) {")],
     "a manual refresh sends no validator",
     CLIENT),

    # The raw purpose and the workspace. Both are in the runtime database and neither may cross
    # the wire: the purpose is free text a person wrote, and the workspace is a location on the
    # reader's own disk. The page gets a token for the first and nothing for the second.
    ("the raw purpose and the workspace cross the wire",
     [("          descriptor.sessionParentId = meta.parent;",
       "          descriptor.sessionParentId = meta.parent;\n"
       "          descriptor.sessionPurpose = meta.purpose;\n"
       "          descriptor.sessionWorkspace = meta.workspace;"),
      ("    sessionParentId: value.sessionParentId ?? null,",
       "    sessionParentId: value.sessionParentId ?? null,\n"
       "    sessionPurpose: value.sessionPurpose ?? null,\n"
       "    sessionWorkspace: value.sessionWorkspace ?? null,")],
     "the raw purpose does not cross the wire"),
]

ORIGINALS = {
    SERVER: io.open(SERVER, encoding="utf-8", newline="").read(),
    CLIENT: io.open(CLIENT, encoding="utf-8", newline="").read(),
}


def run():
    code = 0
    chunks = []
    for probe in PROBES:
        proc = subprocess.run(["node", probe], cwd=HERE,
                              capture_output=True, text=True, encoding="utf-8", errors="replace")
        if code == 0:
            code = proc.returncode
        chunks.append(proc.stdout + proc.stderr)
    return code, "\n".join(chunks)


ok = True
code, baseline = run()
base_ok = code == 0 and "0 failed" in baseline
print(("ok   " if base_ok else "FAIL ") + "baseline green")
ok = ok and base_ok

caught = []
for entry in MUTATIONS:
    title, edits, expect = entry[0], entry[1], entry[2]
    target = entry[3] if len(entry) > 3 else SERVER
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
            for line in during.splitlines()[-6:]:
                print("       " + line.strip())
        elif not red:
            print("       the rule was reported but the guard still exited 0")
        caught.append(named and red)
    finally:
        io.open(target, "w", encoding="utf-8", newline="").write(original)

restored = all(io.open(path, encoding="utf-8", newline="").read() == text
               for path, text in ORIGINALS.items())
after_code, after = run()
after_ok = after_code == 0 and "0 failed" in after
print(("ok   " if restored else "FAIL ") + "both files restored byte for byte")
print(("ok   " if after_ok else "FAIL ") + "green again after restore")

sys.exit(0 if (ok and all(caught) and restored and after_ok) else 1)
