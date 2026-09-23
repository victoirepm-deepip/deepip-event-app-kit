# DeepIP Event App Kit

You are building a sales enablement app for one DeepIP event. This file is the
contract. Read it fully before writing any code, and re-read section 2 before any
`git push` or deployment step.

Two builds exist behind this kit: Munich (Sept 2026) and FICPI Budapest (Sept 2026).
Everything here is a lesson from one of them. When this file and your own judgment
disagree, follow this file and say so in chat.

---

## 1. What you are building

Up to four modules around one Google Sheet. The Sheet is the database. Nothing else is.

| Module | Default | What it is |
|---|---|---|
| **Field app** | always | Mobile PWA used on site. Reads the contact list, writes encounters. |
| **Follow-up page** | on | Static page generated after the event. One draft email per contact, per owner. |
| **Dinner page** | off | Static briefing page for a dinner: who is at the table, why they matter. |
| **RSVP form** | off | Public registration form writing to a Sheet. Feeds the dinner page. |

They chain: RSVP produces the guest list, the guest list feeds the dinner page,
the field app captures what happened, the follow-up page turns captures into drafts.
Each one works alone. Do not merge them into a single application.

---

## 2. Hard rules

Never break these. They are not preferences.

**Repository and data**
- The repo is **private**. Verify before the first push. GitHub Pages on a private
  repo needs a paid plan, so if hosting is Pages, raise it in the interview instead
  of quietly making the repo public.
- **No personal data in the repo.** No contact lists, no photos of people, no CSV or
  JSON extracts, no screenshots containing names. Data lives in the Sheet and is
  loaded at runtime. Photos, when a dinner page needs them, are hosted outside the
  repo or inlined at generation time into a page that is never committed.
- **No competitive intelligence in clear text in the repo.** Never name an account
  alongside a competitor, a lost deal or an ARR figure in a source file or a comment.
  Competitor *names alone*, as a picklist, are fine.
- Photo consent collected through the RSVP module is the legal basis for using anyone's
  image afterwards. Never reuse a photo of an attendee who did not consent.

**Backend**
- The Apps Script is **bound to the Sheet** (Extensions > Apps Script from inside it),
  never standalone. That is what allows the `spreadsheets.currentonly` scope.
- **Three timezones must agree**, and they are set in three different places: the
  Sheet's own setting (File > Settings > Time zone), `timeZone` in
  `appsscript.json`, and `EVENT.timezone` in `config.js`. All three are the local
  timezone of the event, not the timezone of whoever is building it. The Sheet's
  setting is the one that decides how the Date column reads, so a Paris default on
  a Toronto event shifts every capture by six hours and fires the phases at the
  wrong moment. The `Captured at` column is a UTC ISO string and is unaffected,
  which is exactly why the discrepancy is easy to miss.
- **POST only.** No `doGet` on any endpoint that reads data. The Google ID token
  travels in the request body, never in a URL.
- Deployment is `ANYONE_ANONYMOUS` because a domain-restricted deployment returns no
  CORS headers, so access is enforced **in code**: verified token, `email_verified`,
  `hd === 'deepip.ai'`, `aud === CLIENT_ID`.
- **Every column is resolved by header text at runtime.** No hardcoded column index,
  no column letter, ever. Tabs are resolved by name, then loose name, then shape.
- **Writes are append-only and idempotent**, keyed on a client-generated `Client ID`.
  Never update a row by its row number: an offline queue that retries will corrupt it.
- **Never write to HubSpot from the app.** Export, human review, import. That is the
  only path.

**Product**
- **One write surface.** The Sheet is read-only for the field team, the app is the only
  place they write. If both accept writes you get two diverging sources of truth and
  nobody to arbitrate.
- Nothing is gated on the user table. An unknown `@deepip.ai` email gets the full app
  with no default filter. An event is not the place to lock someone out.
- Losing a capture is worse than losing a field. A missing optional column degrades the
  row and raises a warning, it never fails the write.
- **Names are stored split.** The write tab carries `First name` and `Last name` in
  separate columns, never a single `Full name`. Splitting afterwards is guesswork on
  particles, double barrels and reversed order, and it has to be redone on every
  export. `Last name` is the required one: a card read in a noisy room sometimes
  yields only a surname, and that row is still worth writing.
- **Capture fields are core plus extra.** The five core fields are the input contract
  of the follow-up generator and are never removed. Extra fields are added per event,
  from the phase A interview, each with its own frozen column header.

---

## 3. The interview

Run this **before writing code**. Two phases.

### Phase 1: blocking. Do not start until these are answered.

Ask them together, in one message, numbered. No default covers any of them.

1. **Event**: name, dates, city, timezone.
2. **Modules**: which of the four. (Field app is assumed. Follow-up is on unless
   refused. Dinner and RSVP only if there is one.)
3. **Population**: one list or several tracks? Roughly how many people? Is there a
   second list to search against (a delegate directory, a member list)?
4. **People on the floor**: name, email, and for each one, does she or he have an
   assigned list, and is it a tutor-type role (someone who observes people working,
   whose signal is worth its own field)?
4b. **What the team must bring back**: beyond the five core fields, what do you want
   them to capture on site that we do not already have? Ask it in those words, with
   an example or two, because "which extra columns do you want" gets an empty answer
   and "what would you want to know about a firm you just met" does not.
5. **The Sheet**: does it exist yet? If yes, give the tab names and paste the header
   row of each tab. If no, the kit generates the template and the interview stops
   until it is filled.
6. **Writers**: does everyone see and write every record, or is it partitioned?
7. **Hosting**: where does the app get served from, and is the OAuth client's
   authorised origin already covering it? (Origins ignore the path, so any repo under
   an already-authorised GitHub account works. Anything else needs a Cloud console
   change first, or sign-in fails with `origin_mismatch`.)
8. **Phases**: split the event into moments (arrival, masterclass, forum day 1, dinner,
   forum day 2). For each, is the list still useful, or is almost everyone met that
   day absent from the file?

### Phase 2: per module, and only for the modules that are on.

- **Dinner**: guest list source, is there a seating plan, are there photos and where do
  they come from, what does each guest card need to show.
- **Follow-up**: the distinct moments of the event (these become the opening lines),
  who signs, is there a Cc rule, when should the batch go out.
- **RSVP**: the fields, dietary requirements yes or no, photo consent yes or no,
  additional guests yes or no.

### Everything else: apply a default and announce it.

The rule that makes this usable: **never invent a silent default on a Phase 1
question, always apply one everywhere else.** Say what you took, in one line, and
move on. Do not ask about sync intervals, capture picklists, colour, offline
behaviour or file layout. They have defaults in `config.template.js`.

---

## 4. Architecture

```
config.js              you always edit this. Generated from the interview.
Code.gs                the engine. Only the three column maps at the top change.
appsscript.json        one line changes per event: timeZone.
store.js               IndexedDB. Never changes.
auth.js                Google Identity Services. Never changes.
sync.js                queue and round-trip. Never changes.
model.js               filtering, grouping, search. Changes only for a new view.
ui.js                  screens. Changes per event only for a module-specific screen.
app.js                 routing and state. Never changes.
```

If you find yourself editing `store.js`, `auth.js` or `sync.js`, stop and explain why
in chat first. Those three are where the field lessons are buried.

There is no `publish/` folder. The previous build had one and it silently diverged
from the source. Serve the repo root or add a real build step.

---

## 5. Field lessons

Things that cost a build. Carry them forward.

**Freshness is two states, not one.** Munich and Budapest both showed a single
"Synced 4 min ago" line. Users read it as "my captures are saved" and never understood
that what they were *reading* was stale. The code already tracks `lastSyncAt` and
`snapshotAt` separately. Show both, in words, not timestamps:
- outbound: "All your captures are up. " / "3 captures waiting to go up."
- inbound: "You are seeing the list as of 14:12. Pull down to refresh."
Plus an explicit refresh control that a thumb can find without going into Settings.
A capture the user made must appear instantly in their own list, from the queue,
before it has ever reached the Sheet.

**Header collisions corrupt silently.** `Met` prefix-matches `Met by`. Resolution is
exact-match-first, then prefix, and on collision the later field is dropped rather than
allowed to overwrite. Declaration order in the column maps is priority order.

**Editing `Code.gs` is not deploying it.** Deploy > Manage deployments > pencil > New
version > Deploy. The URL stays the same, which is exactly why people think they
shipped when they did not. It belongs in the deployment checklist, not in a comment.

**Column resolution can be perfect while the data makes the app useless.** Run
`selfTest()` and read the counts, not just the column list. An empty `Ownership`
column means the default "assigned to me" view is blank on the morning of day one.
No row flagged for the dinner means the dinner screen is empty. Example rows without
a `Client ID` count towards the evening recap.

**The Sheet gets renamed mid-event.** Keep old tab names as aliases. An alias costs
nothing and saves a redeploy.

---

## 6. Deployment checklist

Run it end to end, on a phone, before handing the app over.

1. Repo is private.
2. `git grep` for names, emails and account names outside the user table. Nothing.
3. Apps Script bound to the Sheet, manifest scopes unchanged, and `timeZone` in
   `appsscript.json` equal to `EVENT.timezone` and to the Sheet's own time zone.
4. `CLIENT_ID` byte-identical in `Code.gs` and `config.js`.
5. OAuth client authorised origin covers the hosting URL.
6. `selfTest()` run from the editor, counts read, warnings resolved.
7. Deploy > Manage deployments > New version. URL copied into `config.js`.
8. Sign in on a phone with a `@deepip.ai` account, from mobile data, not office wifi.
9. Airplane mode on: log a capture, confirm it appears in the list immediately.
10. Airplane mode off: confirm it reaches the Sheet, and only once.
11. Sign in as a second user, confirm they see the first user's capture after a refresh.
12. Add the app to the home screen, confirm it opens as a standalone app.
13. Send the team a single message with the URL, what to do at first launch, and the
    one sentence about how refresh works.

---

## 7. Done means

Someone who was not in this conversation can open the app on their phone, sign in,
find a contact, log a meeting offline, and see it in the Sheet within a minute of
regaining signal. Anything short of that is not done, however complete the code looks.
