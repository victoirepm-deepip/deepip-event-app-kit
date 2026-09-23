# PORTING.md

One-off task. Bring the engine in from `ficpi-field` and generalise it, so that a
new event is a configuration change rather than a code change.

Run this in Claude Code, on this repo, with `ficpi-field` checked out next to it.
Read `CLAUDE.md` first. Work in order: each step assumes the previous one is done.

**Do not fork, clone or "use as template" `ficpi-field`.** Its git history holds
photographs of named third parties and competitive notes naming accounts and lost
deals. Copy files into this repo so that history does not travel.

---

## 1. Copy the engine, unchanged for now

From `ficpi-field`, copy: `app.js`, `auth.js`, `model.js`, `store.js`, `sync.js`,
`ui.js`, `styles.css`, `sw.js`, `index.html`, `manifest.webmanifest`,
`robots.txt`, `icons/`.

Do **not** copy: `config.js` (this repo has `config.template.js`), the
`Dinners people/` folder (personal data), the `dinner/` folder (event content),
the `publish/` folder.

`publish/` was a manual copy of the source that had already diverged from the root
in the original repo. It is not reproduced here. Serve the repo root, or add a real
build step and say so in `README.md`.

Commit this as one commit, on its own, so the diff of step 3 is readable.

## 2. `Code.gs` is already here

Nothing to port. `Code.gs` in this repo is the FICPI engine, already generalised:
configuration blanked, column maps reduced to a reusable default, names split into
`First name` and `Last name` on the write tab, `practitioners` added as an extra
capture field, `selfTest()` warnings freed of hardcoded dates.

Do **not** replace it with the Munich version of the same file, which writes by row
number and has no idempotency, and does not survive an offline queue that retries.

What the frontend must now match, because `Code.gs` already assumes it:

- The encounter payload carries `lastName` and `firstName`, never `fullName`.
  `lastName` is the required one. Check every read path in `model.js`, `ui.js` and
  `app.js` for the old assumption, including the display name on cards and in
  search, and the capture form itself.
- The encounter payload carries `practitioners`, and the capture form renders the
  core fields first, then the extras declared in `CAPTURE_EXTRA`, in order.
- The directory keeps a single `fullName`: a second list is usually a supplied file
  with one name column, and we do not split what we did not collect.

## 3. Replace hardcoded event behaviour with phases

This is the real work of the port. `config.template.js` defines `EVENT.phases`. The
engine currently reads `EVENT.masterclassDay` and `EVENT.forumDays` instead.

Known call sites, from a grep of `ficpi-field`:

- `model.js:390` `isMasterclassDay`
- `model.js:401`, `model.js:412`
- `model.js:438` day label, currently the literal strings "AI Masterclass + dinner" and "The Forum"
- `model.js:480` screen label, currently "Dinner" and "AI Masterclass"
- `ui.js:429`, `ui.js:469` day lists built as `[EVENT.masterclassDay].concat(EVENT.forumDays)`
- `ui.js:511` a preview chip hardcoded to `16 Sept`

Replace all of them with a single resolver, `phaseFor(date)`, that returns the
matching phase from `EVENT.phases`: its `id`, its `label`, its `home` value and its
`tonight` flag. Narrow windows win over wide ones, as documented in the template.
Day lists are derived from the phases, and the settings preview chips are generated
from them too, not written out by hand.

Also generalise:

- `model.js:119` filters on the literal track `"masterclass"`. Track names are
  event-specific. Take the value from config.
- `ui.js:69`, `ui.js:297`, `ui.js:305` say "the FICPI directory". The second list has
  a different name at every event. Take the label from config, defaulting to
  "directory".
- `app.js:239` writes the capture source as "From FICPI directory". Same fix.

## 4. Strip identity from the shell

- `index.html` title, `manifest.webmanifest` name, short name and description,
  the first line of `styles.css`: replace the FICPI strings with placeholders the
  build fills from `EVENT.name`.
- `store.js:14` `DB_NAME` is `"ficpi-field"` and `sw.js:9` `CACHE` is
  `"ficpi-field-v1"`. Both must be derived per event, otherwise two events served
  from the same origin share one IndexedDB and one cache. This is a real bug waiting
  to happen the second time this kit is used. Derive both from a slug in config, and
  bump the cache suffix on every deployment.
- Comments naming individuals ("the morning of the 16th: Bertrand has not filled…",
  `ui.js:154`, `ui.js:370`, `model.js:418`) keep their explanation but lose the names.
  The reasoning is worth keeping, the names are not, and they will be wrong at the
  next event.

## 5. Fix the freshness display

The one substantive product change from the Budapest debrief. The plumbing is
already right: a background attempt every 60 seconds while visible, on `online`, and
on `visibilitychange`, with a pending counter and an offline banner. The label is
what failed. One line reading "Synced 4 minutes ago" answered two different
questions at once, and people read it as "my captures are safe" while the list they
were looking at was stale.

`sync.js` already tracks `lastSyncAt` and `snapshotAt` separately. Surface both:

- outbound, in words: "All your captures are up." or "3 captures waiting to go up."
- inbound, with the time the data was read: "You are seeing the list as of 14:12."
  Past `SYNC.snapshotStaleAfterMs`, say it is old. Past `promptRefreshAfterMs`, make
  it a banner rather than a line.
- an explicit refresh control a thumb can reach, plus pull to refresh, without going
  into Settings.

A capture the user just made appears in their own list immediately, from the queue,
before it has reached the Sheet. That behaviour already exists in `app.js`. Do not
break it while changing the status area.

## 6. Verify

- `git grep` for: any person's name, any email that is not a placeholder, any firm
  name, any competitor name next to an account, `ficpi`, `budapest`, a real Sheet ID,
  a real client ID, a real `/exec` URL. All must come back empty.
- No file under `icons/` is a photograph of a person.
- Run through `CLAUDE.md` section 6 mentally: every item must be executable against
  this repo as it now stands.

## 7. Record what you changed

Append to `CLAUDE.md`, under section 5, anything you discovered during the port that
the next person would otherwise rediscover. Then delete this file: it is a one-off,
and a repo that keeps its migration notes forever stops being readable.
