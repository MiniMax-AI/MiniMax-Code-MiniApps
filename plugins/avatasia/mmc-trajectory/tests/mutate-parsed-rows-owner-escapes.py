"""Mutation control for the owner escapes two review rounds reported.

  Round sixteen:
  R29-F31  the promise sentence names minutes in words the parser did not know, and the owner of
           "the two forms are the same promise" held VACUOUSLY: it could not read the words, and
           a promise nobody can check is not a promise anybody checked.
  R29-F32  the page hands its timer a comma expression -- `(TRAJECTORY_POLL_INTERVAL, 8000000)`
           -- and the owner read the characters around the name instead of the argument the timer
           is really given, so the timer was seen to wait 8000 while it waits 8000000.
  R29-F33  a template literal holding a declaration impersonated the proxy's numeric declaration
           while the binding the service really uses was the string "2".

  Round seventeen:
  R29-F34  the same parser read the END of the words and dropped the rest, so "one hundred twelve
           and a half minutes (750000 ms)" was read as twelve and a half -- a promise that states
           one number in words and another in milliseconds, and the owner called it agreement.
  R29-F35  the guard's own copy could not be imported, and the owner of "the shipped default is
           the interval the service declares" compared the interval the cache really uses with the
           number it could not read -- so a broken harness accused a rule that was not broken.

  Round eighteen:
  R29-F36  the PHRASE was cut, not the words: the scan that walks back from the millisecond form
           stopped at a thousands separator and at an ampersand -- both of which can appear INSIDE a
           number -- so "one thousand, twelve and a half minutes (750000 ms)" was read as twelve and
           a half, and the tail agreed with the promise while the phrase did not.
  R29-F37  a sentence written BEFORE the promise said the same words, and the owner took the first
           sentence that contained them: the promise to a reader was read out of an annotation left
           beside it, and the annotation agreed with the cache.
  R29-F38  the page's inline script did not run, and the three owners that read the page's delay
           compared a value they never saw: the premise failed loudly, and three rules were
           accused anyway.

  Round nineteen:
  R29-F39  a scale word the number table does not know was DROPPED, and the tail was read instead:
           "one myriad twelve and a half minutes (750000 ms)" was read as twelve and a half -- a
           promise that states one number in words and another in milliseconds, and the owner called
           it agreement. A word that cannot be read has to make the phrase unreadable, not shorten
           it.
  R29-F40  the form that finds the promise knew ONE spelling of the unit, so a promise written
           "600000 milliseconds" was invisible and the annotation beside it became the only
           candidate: both owners of the number read the annotation, and reported the promise to be
           sound.
  R29-F41  two promise forms inside ONE sentence were counted as one promise, so the owner of the
           bound accused a limit the block states correctly -- the number it accused was one of two,
           and neither of them was THE number.

  Round twenty:
  R29-F42  the reader refused an unknown word only when ONE neighbour said the word was part of a
           number, so two unsupported words in front of the number -- or an unsupported head behind
           ordinary sentence context -- were dropped, and the tail was read instead, and the tail
           agreed with the promise's other form.
  R29-F43  the locator recognised the promise only in the shapes it could read, so a promise
           written "600000.0 milliseconds" -- or with a unit it had no factor for -- was not a
           candidate at all, and the annotation beside it became the only candidate and answered
           for it.
  R29-F44  one ordinary context word in front of the number made the minutes unreadable, and the
           owner of the two forms reported that they DISAGREE -- an accusation that is false, because
           both forms state the same number. An unreadable phrase is not a disagreement, and an
           owner that reports one is accusing a rule nobody broke.

  Round twenty-one:
  R29-F45  the reader erased a SIGN along with the hyphens it walks over, so "-12.5 minutes
           (750000 ms)" was read as twelve and a half -- a promise that states one number in
           words and another in milliseconds, and the owner called it agreement. A signed number
           is not a number of minutes a promise can state, so the phrase is not read at all.
  R29-F46  the unit table was asked for a name it INHERITS: "constructor" resolves to Object's
           constructor, the multiplication gave NaN, and that NaN counted as one OBSERVED number
           -- so the owners of the number accused a promise that stated no number at all, while
           the premise that says the number could not be read stayed green.
  R29-F47  the locator counted only the promise forms it could read: a promise written
           "minutes ((600000 ms))" had its number hidden, the annotation beside it became the
           only candidate, and the owners of the number read the annotation and reported the
           promise to be sound.

  Round twenty-two:
  R29-F48  the characters a hyphen may be written with were not ONE family: the reader knew the
           ASCII hyphen, so a promise written with the Unicode MINUS SIGN was not read as a
           signed number at all -- "-12.5 minutes (750000 ms)" was read as twelve and a half, a
           promise that states one number in words and another in milliseconds, and the owner
           called it agreement. A sign is a sign whichever character it is written with.
  R29-F49  a phrase that holds a SLASH was cut at the slash, so "25/12.5 minutes (750000 ms)" was
           read as its denominator -- twelve and a half -- and the two forms of the promise were
           declared the same when the phrase says something else. A fraction is not a number of
           minutes a promise can state, so the phrase is not read at all.
  R29-F50  the guard read the FIRST spelling of a name in the file, so a decoy could answer for
           the promise: a local copy of the constant inside a function that is never called, with
           its own comment above it, supplied the prose, and the guard was green while the
           declaration the module really uses said something else. And a comment that stands above
           other code documents that other code -- so the documentation has to TOUCH the
           declaration as well as belong to the module.

THE TWELFTH CASE BREAKS THE GUARD'S OWN READER, and so do the two cases before it that break the
machinery that reads the promise: the break is in the guard and not in the shipped source, so the
guard's own assertion about reading a whole phrase is the one that has to go red. An assertion
that no case can make fail is an assertion nobody is watching.

THE SIXTEEN OTHER CASES THAT BREAK THE GUARD BREAK ITS READER AND ITS LOCATOR, and they are the
same shape: the break is in the machinery that reads the promise -- the words that may stand in
front of a number, the reader of a decimal point, the reader of a unit it does not know, the
reader of a sign, the reader of a fraction, the reader of the characters a hyphen may be written
with, the reader of the declaration the documentation has to belong to, and the locator that
counts the forms -- so the guard's own assertions about that machinery are the ones that have to
go red. A rule that reads the promise has an owner, and the owner is an assertion about the
reading itself.

Each case breaks one file and one rule, and a case counts as caught only when the guard reported
THAT rule -- by name -- and nothing else. The guard has to go red by NAMING a rule: a guard that
threw, or that went red without naming anything, has not shown that it owns this break.

WHY THIS IS A SEPARATE FILE. `tests/mutate-parsed-rows.py` owns the forty cases of the cache's
own behaviour, and its EXACT table is the single source of truth for which rules each of those
breaks may report. Those forty cases and that table are frozen: neither round changed product
behaviour, only the owners of rules, so adding these to that file would have meant rewriting a
table that is not this round's to rewrite. A control whose table has two owners is a table with no
owner. So the escapes get their own control, and the suite runs one more file.

THE RULES ARE CHECKED THE WAY THE ROUNDS THAT FOUND THEM ASKED FOR: the owner has to be a
BEHAVIOUR, not a shape. The page's script is run in a sandbox and the delay comes from the timer
the page itself starts; the service's numbers come from the module's own bindings.

A CASE IS A TUPLE, AND THAT IS NOT A MATTER OF STYLE. `tests/verify-mutation-contracts.py` reads
this file's source to decide whether it judges its cases by membership -- whether the case's own
expected rule name is tested against the collection of names the guard reported -- and it reads a
case table as a LIST OF TUPLES. A case written as a dictionary is invisible to it, and a control
the guard cannot read is a control the guard cannot hold to the contract: this file was written
with dictionaries once, and the guard reported it as judging by the exit code alone. So the cases
are tuples, and a case that needs more than one edit carries its edits in parallel lists.

TWO CASES BREAK THE GUARD ITSELF, and they are two shapes a control of this kind has to be able
to state:

  * a case can break the copy the guard reads the service's numbers from, so the guard cannot
    observe them. The guard then has to FAIL LOUDLY -- by naming the rule it could not observe --
    and it must not accuse any other rule: a number the guard could not read is not a broken
    rule. The exact set is what says so: a guard that also reported "the shipped default is the
    interval the service declares" would have accused a rule the break did not break.
  * a case can break TWO things at once, when the escape only exists in that combination. The
    mis-accusation needs the observation to have failed AND the owner to compare anyway, so the
    case breaks the copy and removes the gate, and the guard has to name the rule that says it
    accuses nothing it could not observe.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
SERVER = ROOT / "miniapp" / "node" / "server.mjs"
CLIENT = ROOT / "miniapp" / "client" / "index.html"
PROBE = HERE / "verify-parsed-rows.mjs"

# Each case: what it breaks, the files it breaks, the text before and after each of them, the
# rule that owns it, the EXACT set of rules that break may report, and anything the output has to
# say.
#
# The exact set is the isolation, and it is what the frozen control's table does for the other
# forty: a guard that also reported a rule this break did not break has accused another owner,
# and a reader cannot tell which rule had actually been broken.
#
# The anchor of every edit has to occur EXACTLY once in the file it edits. A control that replaces
# the first occurrence of a string that occurs twice edits a place it did not mean to edit, and
# the case then passes or fails for a reason that has nothing to do with the rule it is about.
MUTATIONS = [
    (
        "the promise sentence names minutes in words the parser did not know",
        [SERVER],
        ["one sweep interval after the limit — twelve and a half minutes (750000 ms) with the shipped"],
        ["one sweep interval after the limit — thirteen minutes (750000 ms) with the shipped"],
        "the promise to a reader is the same promise in both of the forms it is written in",
        ("the promise to a reader is the same promise in both of the forms it is written in",),
        (),
    ),
    (
        "the page hands its timer a comma expression",
        [CLIENT],
        ["        }, TRAJECTORY_POLL_INTERVAL);"],
        ["        }, (TRAJECTORY_POLL_INTERVAL, 8000000));"],
        "the poll waits as long as the client declares",
        (
            "the poll waits as long as the client declares",
            "the time limit is longer than one poll, so an open tab never loses its rows",
        ),
        (),
    ),
    (
        "a template literal impersonates the proxy's declaration while the binding is a string",
        [SERVER],
        ["\nconst PARSED_ROWS_HEAP_PER_SOURCE_BYTE = 2;\n"],
        ["\nconst annotation = `\nconst PARSED_ROWS_HEAP_PER_SOURCE_BYTE = 2;\n`;\n"
         "const PARSED_ROWS_HEAP_PER_SOURCE_BYTE = '2';\n"],
        "the heap proxy is a number the service declares",
        ("the heap proxy is a number the service declares",),
        (),
    ),
    (
        "the minutes are written as a compound the parser reads as a smaller number",
        [SERVER],
        ["after the limit — twelve and a half minutes (750000 ms)"],
        ["after the limit — one hundred twelve and a half minutes (750000 ms)"],
        "the promise to a reader is the same promise in both of the forms it is written in",
        ("the promise to a reader is the same promise in both of the forms it is written in",),
        (),
    ),
    (
        "the copy the guard reads the service's numbers from will not import",
        [PROBE],
        ["await writeFile(join(dir, 'server.mjs'), `${shipped}\\nexport { ${names.join(', ')} };\\n`);"],
        ["await writeFile(join(dir, 'server.mjs'), `${shipped}\\nexport { nonexistentBinding };\\n`);"],
        "the guard could not observe the numbers the service declares",
        ("the guard could not observe the numbers the service declares",),
        # The owners that could not be compared have to say so: an owner that held quietly is an
        # owner nobody can tell apart from one that was checked and matched.
        ("held vacuously",),
    ),
    (
        "the copy will not import and the owner compares the interval anyway",
        [
            PROBE,
            PROBE,
        ],
        [
            "await writeFile(join(dir, 'server.mjs'), `${shipped}\\nexport { ${names.join(', ')} };\\n`);",
            "holds(createParsedRowsCache(1000).sweepIntervalMs === SHIPPED_SWEEP, true, BINDINGS !== null)",
        ],
        [
            "await writeFile(join(dir, 'server.mjs'), `${shipped}\\nexport { nonexistentBinding };\\n`);",
            "holds(createParsedRowsCache(1000).sweepIntervalMs === SHIPPED_SWEEP, true, true)",
        ],
        "the guard accuses no rule it could not observe",
        (
            "the guard accuses no rule it could not observe",
            "the guard could not observe the numbers the service declares",
            "the shipped default is the interval the service declares",
        ),
        (),
    ),
    (
        "the promise states a compound number whose thousands separator hides the head of it",
        [SERVER],
        ["after the limit — twelve and a half minutes (750000 ms)"],
        ["after the limit — one thousand, twelve and a half minutes (750000 ms)"],
        "the promise to a reader is the same promise in both of the forms it is written in",
        ("the promise to a reader is the same promise in both of the forms it is written in",),
        (),
    ),
    (
        "the promise states a compound number with an ampersand in it",
        [SERVER],
        ["after the limit — twelve and a half minutes (750000 ms)"],
        ["after the limit — one hundred & twelve and a half minutes (750000 ms)"],
        "the promise to a reader is the same promise in both of the forms it is written in",
        ("the promise to a reader is the same promise in both of the forms it is written in",),
        (),
    ),
    (
        "the promise states the same number with a thousands separator in it",
        [SERVER],
        ["after the limit — twelve and a half minutes (750000 ms)"],
        ["after the limit — 1,012.5 minutes (750000 ms)"],
        "the promise to a reader is the same promise in both of the forms it is written in",
        ("the promise to a reader is the same promise in both of the forms it is written in",),
        (),
    ),
    (
        "a sentence written before the promise says the same words, and the promise says another number",
        [
            SERVER,
            SERVER,
        ],
        [
            " * **WHEN THEY COME BACK IS NOT THE SAME MOMENT AS WHEN THEY EXPIRE.**",
            "one sweep interval after the limit — twelve and a half minutes (750000 ms) with the shipped",
        ],
        [
            " * Historical annotation, no later than twelve and a half minutes (750000 ms).\n"
            " * **WHEN THEY COME BACK IS NOT THE SAME MOMENT AS WHEN THEY EXPIRE.**",
            "one sweep interval after the limit — fourteen minutes (840000 ms) with the shipped",
        ],
        "the promise to a reader is stated exactly once, in the sentence that carries the number in brackets",
        ("the promise to a reader is stated exactly once, in the sentence that carries the number in brackets",),
        (),
    ),
    (
        "the page's inline script does not run, so the owners below cannot read what they are about",
        [CLIENT],
        ["    <script>\n      'use strict';"],
        ["    <script>\n      new ResizeObserver(() => {});\n      'use strict';"],
        "the guard could not observe the page's polling interval",
        ("the guard could not observe the page's polling interval",),
        # The owners that could not be compared have to say so: an owner that held quietly is an
        # owner nobody can tell apart from one that was checked and matched.
        ("held vacuously",),
    ),
    (
        "the reader stops at the thousands separator and answers with the tail of the phrase",
        [PROBE],
        [r"const PHRASE_CLASS = new RegExp(`[A-Za-z0-9\\s.,&'/${HYPHEN_CLASS}]`);"],
        [r"const PHRASE_CLASS = new RegExp(`[A-Za-z0-9\\s.&'/${HYPHEN_CLASS}]`);"],
        "the promised minutes are read from the whole phrase, not from a tail of it",
        ("the promised minutes are read from the whole phrase, not from a tail of it",),
        (),
    ),
    (
        "the promise names a scale word the number table does not know",
        [SERVER],
        ["one sweep interval after the limit — twelve and a half minutes (750000 ms) with the shipped"],
        ["one sweep interval after the limit — one myriad twelve and a half minutes (750000 ms) with the shipped"],
        "the guard could not read the minutes the promise states",
        ("the guard could not read the minutes the promise states",),
        # The owner of the two forms cannot compare a promise it could not read, so it holds
        # vacuously and counts itself.  It used to be this owner that went red here, and it went
        # red by calling the two forms DISAGREENT -- a disagreement the block does not state, and
        # one that no reader of the promise would ever see.  The escape is caught, and now it is
        # caught by the owner of the thing that is actually wrong: the minutes cannot be read.
        ("held vacuously",),
    ),
    (
        "the promise is written with the unit spelled out, and the annotation beside it answers the form",
        [SERVER],
        ["one sweep interval after the limit — twelve and a half minutes (750000 ms) with the shipped"],
        ["one sweep interval after the limit — ten minutes (600000 milliseconds) with the shipped. "
         "Annotation twelve and a half minutes (750000 ms)"],
        "the promise to a reader is stated exactly once, in the sentence that carries the number in brackets",
        ("the promise to a reader is stated exactly once, in the sentence that carries the number in brackets",),
        # The two owners of the number cannot locate a promise that is stated twice, so they say
        # so instead of accusing a number nobody can point at.
        ("held vacuously",),
    ),
    (
        "two promise forms share one sentence, and the bound is accused over a number nobody can locate",
        [SERVER],
        ["one sweep interval after the limit — twelve and a half minutes (750000 ms) with the shipped"],
        ["one sweep interval after the limit — historical annotation twelve and a half minutes (750000 ms); "
         "the rows are gone no later than fourteen minutes (840000 ms) with the shipped"],
        "the promise to a reader is stated exactly once, in the sentence that carries the number in brackets",
        ("the promise to a reader is stated exactly once, in the sentence that carries the number in brackets",),
        # The owner of the bound holds vacuously here: there is no single number to accuse, and
        # accusing the one the block states correctly would be accusing a rule nobody broke.
        ("held vacuously",),
    ),
    # ------------------------------------------------------------------ round twenty
    #
    # The twentieth pass found three escapes in the owners of the promise, and all three are the
    # same shape: the machinery guessed, and where the guess failed it dropped what it did not
    # understand instead of saying so.
    #
    #   R29-F42  the reader refused an unknown word only when ONE neighbour said the word was part
    #             of a number. Two unsupported words in front of the number, or an unsupported head
    #             behind ordinary sentence context, were dropped -- and the tail was read, and the
    #             tail agreed with the promise's other form.
    #   R29-F43  the locator recognised the promise only in the shapes it could read, so a promise
    #             written "600000.0 milliseconds" -- or with a unit it had no factor for -- was not
    #             a candidate at all, and the annotation beside it became the only candidate and
    #             answered for it.
    #   R29-F44  one ordinary context word in front of the number made the minutes unreadable, and
    #             the owner of the two forms then reported that they DISAGREE -- an accusation that
    #             is false, because both forms state the same number.
    #
    # The first three cases below are those escapes, on the shipped source. The last six break the
    # guard's own machinery: the list of words that may stand in front of a number, the reader of
    # a number written with a decimal point, the reader of a number in a unit it does not know, and
    # the rule that says a word in front of the number has to be known. A rule that reads the
    # promise has an owner, and the owner is an assertion about the reading itself.
    (
        "the promise names words the reader does not know, and the reader reads the tail",
        [SERVER],
        ["one sweep interval after the limit — twelve and a half minutes (750000 ms) with the shipped"],
        ["one sweep interval after the limit — one great myriad twelve and a half minutes (750000 ms) "
         "with the shipped"],
        "the guard could not read the minutes the promise states",
        ("the guard could not read the minutes the promise states",),
        # The owner of the two forms cannot compare a promise it could not read, so it holds
        # vacuously and counts itself -- it does not accuse a disagreement it did not find.
        ("held vacuously",),
    ),
    (
        "the promise is written with a decimal point, and the annotation beside it answers for it",
        [SERVER],
        ["one sweep interval after the limit — twelve and a half minutes (750000 ms) with the shipped"],
        ["one sweep interval after the limit — ten minutes (600000.0 milliseconds) with the shipped. "
         "Historical annotation twelve and a half minutes (750000 ms) with the shipped"],
        "the promise to a reader is stated exactly once, in the sentence that carries the number in brackets",
        ("the promise to a reader is stated exactly once, in the sentence that carries the number in brackets",),
        ("held vacuously",),
    ),
    (
        "the promise is written with a unit the reader does not know, and the annotation answers for it",
        [SERVER],
        ["one sweep interval after the limit — twelve and a half minutes (750000 ms) with the shipped"],
        ["one sweep interval after the limit — ten minutes (600000 millisec) with the shipped. "
         "Historical annotation twelve and a half minutes (750000 ms) with the shipped"],
        "the promise to a reader is stated exactly once, in the sentence that carries the number in brackets",
        ("the promise to a reader is stated exactly once, in the sentence that carries the number in brackets",),
        ("held vacuously",),
    ),
    (
        "the owner compares the two forms even when it could not read the minutes",
        [
            SERVER,
            PROBE,
        ],
        [
            "one sweep interval after the limit — twelve and a half minutes (750000 ms) with the shipped",
            "holds(samePromiseInBothForms, true, sameFormsComparable)",
        ],
        [
            "one sweep interval after the limit — one great myriad twelve and a half minutes (750000 ms) "
            "with the shipped",
            "holds(samePromiseInBothForms, true, bothFormsWritten)",
        ],
        "the promise to a reader is the same promise in both of the forms it is written in",
        (
            "the promise to a reader is the same promise in both of the forms it is written in",
            "the guard could not read the minutes the promise states",
            # And the guard's own rule about accusing: an owner that compares what it could not
            # read is an owner that accused a rule nobody broke, and that is what this third name
            # says.
            "the guard accuses no rule it could not observe",
        ),
        (),
    ),
    (
        "a number word is a lead-in word, and the reader reads the tail again",
        [PROBE],
        ["'there', 'these', 'this', 'those', 'to', 'under', 'until', 'up', 'upon', 'within', 'without',"],
        ["'there', 'these', 'this', 'those', 'to', 'under', 'until', 'up', 'upon', 'within', 'without', "
         "'one',"],
        "no word the reader reads as part of a number may be a lead-in word",
        (
            "no word the reader reads as part of a number may be a lead-in word",
            # And the behaviour goes with it: a number word in the lead-in lets the reader state
            # the tail of the phrase instead of the phrase -- "one more than twelve and a half" is
            # thirteen and a half, and reading the tail would state twelve and a half, which
            # happens to agree with the promise's other form.
            "a word in front of the number that the reader does not know makes the phrase unreadable",
        ),
        (),
    ),
    (
        "the reader cannot read a number written with a decimal point",
        [PROBE],
        ["const PROMISE_NUMBER = /^\\s*(\\d[\\d,]*(?:\\.\\d+)?)\\s*([a-z]+)\\s*$/i;"],
        ["const PROMISE_NUMBER = /^\\s*(\\d[\\d,]*)\\s*([a-z]+)\\s*$/i;"],
        "a number in brackets written with a decimal point is the number it states",
        ("a number in brackets written with a decimal point is the number it states",),
        (),
    ),
    (
        "the reader skips a number it cannot read instead of refusing it",
        [PROBE],
        ["  if (!Object.prototype.hasOwnProperty.call(UNIT_IN_MS, unit)) return null;"],
        ["  if (!Object.prototype.hasOwnProperty.call(UNIT_IN_MS, unit)) return 0;"],
        "a number in brackets that this reader cannot read is refused rather than skipped",
        # This break makes an unreadable unit read as ZERO -- a number -- so it breaks the rule
        # that says an unreadable number is refused, and the rule that says a unit this reader
        # does not know supplies no number: both of them are the same fact seen from two sides.
        ("a number in brackets that this reader cannot read is refused rather than skipped",
         "a unit that this reader does not know supplies no number, whatever name it carries"),
        (),
    ),
    (
        "the promise states its number in a unit the reader does not know",
        [SERVER],
        ["after the limit — twelve and a half minutes (750000 ms)"],
        ["after the limit — twelve and a half minutes (750000 millisec)"],
        "the guard could not read the number in the brackets of the promise",
        ("the guard could not read the number in the brackets of the promise",),
        # The owners of the number cannot compare a number nobody could read, so they hold
        # vacuously and count themselves.
        ("held vacuously",),
    ),
    (
        "the reader drops the words in front of the number that it does not know",
        [PROBE],
        ["  for (let index = 0; index < start; index += 1) {\n"
         "    if (!LEAD_IN.has(words[index])) return null;\n"
         "  }"],
        ["  if (start >= 2 && isNumberWord(words[start - 2])) return null;\n"
         "  if (start === 1 && !isNumberWord(words[0])) return null;"],
        "a word in front of the number that the reader does not know makes the phrase unreadable",
        ("a word in front of the number that the reader does not know makes the phrase unreadable",),
        (),
    ),
    (
        "the scan walks past a dash written as a hyphen, and the number behind it cannot be located",
        [PROBE],
        ["    if (start >= 2 && isHyphenLike(sentence[start - 1]) && sentence[start - 2] === ' '\n"
         "      && sentence[start] === ' ') break;"],
        ["    // the dash is not a boundary any more"],
        "a dash in front of the number ends the phrase, whether it is written as a dash or a hyphen",
        ("a dash in front of the number ends the phrase, whether it is written as a dash or a hyphen",),
        (),
    ),
    (
        "the promise states a number in front of the number, and the tail is read instead",
        [SERVER],
        ["after the limit — twelve and a half minutes (750000 ms)"],
        ["after the limit — one more than twelve and a half minutes (750000 ms)"],
        "the guard could not read the minutes the promise states",
        ("the guard could not read the minutes the promise states",),
        # "one more than twelve and a half" states THIRTEEN AND A HALF. A reader that read the tail
        # would state twelve and a half -- a number that happens to agree with the promise's other
        # form, which is the worst case there is.
        ("held vacuously",),
    ),
    (
        "the promise states two numbers, and the second one is read",
        [SERVER],
        ["after the limit — twelve and a half minutes (750000 ms)"],
        ["after the limit — two no later than twelve and a half minutes (750000 ms)"],
        "the guard could not read the minutes the promise states",
        ("the guard could not read the minutes the promise states",),
        ("held vacuously",),
    ),
    (
        "the reader reads a signed number as its absolute value",
        [PROBE],
        ["  for (let at = 0; at < text.length; at += 1) {\n"
         "    if (!isHyphenLike(text[at])) continue;\n"
         "    const before = at > 0 ? text[at - 1] : '';\n"
         "    const after = at + 1 < text.length ? text[at + 1] : '';\n"
         "    if (!/[A-Za-z0-9]/.test(before) || !/[A-Za-z0-9]/.test(after)) return null;\n"
         "  }"],
        ["  // the sign is not a sign any more"],
        "a number in the minutes that carries a sign is refused rather than read as its absolute value",
        ("a number in the minutes that carries a sign is refused rather than read as its absolute value",),
        (),
    ),
    (
        "the unit table is asked for a name it inherits",
        [PROBE],
        ["  if (!Object.prototype.hasOwnProperty.call(UNIT_IN_MS, unit)) return null;"],
        ["  if (UNIT_IN_MS[unit] === undefined) return null;"],
        "a unit that this reader does not know supplies no number, whatever name it carries",
        ("a unit that this reader does not know supplies no number, whatever name it carries",),
        (),
    ),
    (
        "a number of milliseconds that overflows is read as a number",
        [PROBE],
        ["  if (!Number.isFinite(value)) return null;"],
        ["  if (value === undefined) return null;"],
        "a number of milliseconds that overflows is not a number of milliseconds",
        ("a number of milliseconds that overflows is not a number of milliseconds",),
        (),
    ),
    (
        "the locator counts only the promise forms it can read",
        [PROBE],
        ["    for (const anchor of sentence.matchAll(PROMISE_ANCHOR)) {\n"
         "      const open = anchor.index + anchor[0].lastIndexOf('(');"],
        ["    for (const anchor of sentence.matchAll(/\\bminutes?\\s*\\(([^()]*)\\)/gi)) {\n"
         "      const open = anchor.index + anchor[0].lastIndexOf('(');"],
        "a promise form with brackets inside it is counted rather than skipped",
        ("a promise form with brackets inside it is counted rather than skipped",),
        (),
    ),
    (
        "the reader knows one spelling of the sign and reads the other spellings as positive numbers",
        [PROBE],
        ["  for (let at = 0; at < text.length; at += 1) {\n"
         "    if (!isHyphenLike(text[at])) continue;\n"],
        ["  for (let at = 0; at < text.length; at += 1) {\n"
         "    if (text[at] !== '-') continue;\n"],
        "a number in the minutes that carries a sign is refused rather than read as its absolute value",
        ("a number in the minutes that carries a sign is refused rather than read as its absolute value",),
        # The Unicode MINUS SIGN is the same sign as the ASCII hyphen. A reader that knows one
        # spelling of it and not the others reads a promise of negative minutes as a promise of
        # positive ones -- and the two forms of that promise then agree.
        (),
    ),
    (
        "the reader stops at the slash and reads the denominator of the fraction",
        [PROBE],
        [r"const PHRASE_CLASS = new RegExp(`[A-Za-z0-9\\s.,&'/${HYPHEN_CLASS}]`);"],
        [r"const PHRASE_CLASS = new RegExp(`[A-Za-z0-9\\s.,&'${HYPHEN_CLASS}]`);"],
        "a number phrase written as a fraction is refused rather than read as its denominator",
        ("a number phrase written as a fraction is refused rather than read as its denominator",),
        (),
    ),
    (
        "the reader takes a local copy of the constant for the declaration the module uses",
        [PROBE],
        ["    if (braceDepthAt(source, mask, match.index) !== 0) continue;"],
        ["    // the scope of the declaration is not checked here"],
        "the documentation the guard reads belongs to the declaration, not to a decoy",
        ("the documentation the guard reads belongs to the declaration, not to a decoy",),
        (),
    ),
    (
        "the reader takes the nearest block above the declaration, whatever stands between them",
        [PROBE],
        ["  // The comment has to end right above the declaration: only whitespace may stand between them.\n"
         "  let cursor = before.length - 1;\n"
         "  while (cursor >= 0 && /\\s/.test(before[cursor])) cursor -= 1;\n"
         "  if (cursor < 1 || before[cursor] !== '/' || before[cursor - 1] !== '*') return null;\n"
         "  const start = before.lastIndexOf('/**', cursor);\n"
         "  if (start < 0) return null;\n"
         "  // And it has to be ONE comment: another '*/' between its opening and this one means the text\n"
         "  // is two comments, and the first of them documents something else. The closing of THIS block\n"
         "  // starts one character before the one this block ends on, so the search for an earlier closing\n"
         "  // has to start one character before THAT -- otherwise the block finds its own ending.\n"
         "  if (before.lastIndexOf('*/', cursor - 2) >= start) return null;\n"
         "  return before.slice(start, cursor + 1);"],
        ["  // The nearest block above the declaration, whatever stands between them.\n"
         "  const start = before.lastIndexOf('/**');\n"
         "  if (start < 0) return null;\n"
         "  const end = before.lastIndexOf('*/');\n"
         "  return end > start ? before.slice(start, end) : null;"],
        "the documentation the guard reads belongs to the declaration, not to a decoy",
        ("the documentation the guard reads belongs to the declaration, not to a decoy",),
        (),
    ),
]


def read_exact(path):
    """Normalise to LF for matching, and report the file's own newline so it can be put back.

    Matching against the raw bytes would make every multi-line anchor miss -- which the runner
    reports as a surviving mutation, so the failure looks like a dead guard rather than a
    broken anchor.
    """
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


def rule_name(text):
    """The name of a rule a probe reported, without the evidence a comparison carries.

    A probe reports an assertion as `<name>` and a comparison as
    `<name>: got <value>, want <value>`. The values are the evidence, not the rule, so they are
    cut off -- and the cut is made at a `: got ` whose tail really is `<json>, want <json>`, so a
    name that itself contains those words is not truncated.
    """
    for match in reversed(list(re.finditer(re.escape(": got "), text))):
        head = text[:match.start()].strip()
        tail = text[match.end():]
        cut = tail.rfind(", want ")
        if cut < 0:
            continue
        try:
            json.loads(tail[:cut])
            json.loads(tail[cut + len(", want "):])
        except ValueError:
            continue
        return head
    return text


def reported_rules(output):
    """The rules a probe named as broken.

    Two formats, as in `mutate-parsed-rows.py`: `  - <name>` and `FAIL <name>`. A case is
    only caught when the rule it names is among them. A NOTE the probe printed -- the reason a
    copy would not import -- is not a rule and is not among them.
    """
    names = []
    for line in output.splitlines():
        text = line.strip()
        if text.startswith("- "):
            names.append(rule_name(text[2:].strip()))
        elif text.startswith("FAIL "):
            names.append(rule_name(text[5:].strip()))
    return names


def main():
    code, output = run_probe()
    if code != 0:
        print("baseline probe does not pass; fix that first")
        print(output)
        return 1
    print("baseline clean")

    originals = {}
    missed = []
    unnamed = []
    for label, targets, olds, news, expect, exact, must_contain in MUTATIONS:
        edits = list(zip(targets, olds, news))
        # Every edit has to land, or the case does not run at all: a case that did not happen
        # proves nothing, and reporting it as "got through" would blame the guard for an anchor
        # that has gone stale.
        stale = None
        for target, old, new in edits:
            if target not in originals:
                originals[target] = target.read_bytes()
            text, newline = read_exact(target)
            if text.count(old) != 1:
                stale = f"anchor found {text.count(old)} times"
                break
            if old == new:
                stale = "the mutation changes nothing"
                break
        if stale is not None:
            print(f"SKIP  {label}: {stale}")
            missed.append(label)
            continue
        for target, old, new in edits:
            text, newline = read_exact(target)
            write_exact(target, text.replace(old, new, 1), newline)
        try:
            code, output = run_probe()
        finally:
            for target in {target for target, _, _ in edits}:
                target.write_bytes(originals[target])
        if code == 0:
            print(f"MISSED {label}: the probe still passed")
            missed.append(label)
            continue
        names = reported_rules(output)
        if not names:
            print(f"UNNAMED {label}: the probe failed without naming a rule")
            unnamed.append(label)
            continue
        # The case names the rule it is about, so the probe has to name THAT rule and not some
        # other one that happened to go red in the same run: a probe that went red elsewhere has
        # not shown that this guard owns this mutation.
        if expect not in names:
            print(f"MISSED {label}: the probe named {names} instead of {expect}")
            missed.append(label)
            continue
        # When the case names the exact set of rules that may go red, a guard that also reported
        # a rule this break did not break has failed the case: it accused another owner.
        if set(names) != set(exact):
            print(f"OVERREACH {label}: the probe named {sorted(set(names))} "
                  f"instead of exactly {sorted(set(exact))}")
            missed.append(label)
            continue
        # Anything the case says the probe has to say -- the owners that could not be compared
        # have to say that they could not be compared.
        missing = [needle for needle in must_contain if needle not in output]
        if missing:
            print(f"MISSED {label}: the probe did not say {missing}")
            missed.append(label)
            continue
        print(f"caught {label}\n         -> {expect}")

    for target, original in originals.items():
        if target.read_bytes() != original:
            print(f"NOT RESTORED {target}")
            return 1
    print("file restored byte-for-byte")

    if missed or unnamed:
        if missed:
            print(f"\n{len(missed)} mutation(s) got through")
        if unnamed:
            print(f"{len(unnamed)} mutation(s) failed without naming a rule")
        return 1
    print(f"\nall {len(MUTATIONS)} mutations caught, each by name")
    return 0


if __name__ == "__main__":
    sys.exit(main())
