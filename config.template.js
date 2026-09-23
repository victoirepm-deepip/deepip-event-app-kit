/* DeepIP Event App Kit — configuration template.
   Copy to config.js and fill. This is the only file you should need to edit
   after deployment, apart from the three column maps at the top of Code.gs.

   Nothing in here is secret, but nothing in here is data either: no contact
   names, no account names, no notes. See CLAUDE.md section 2. */

/* ---- Backend ---------------------------------------------------------- */

// Apps Script Web App URL. Deploy > New deployment > Web app,
// Execute as "Me", Who has access "Anyone". Ends in /exec.
//
// Editing Code.gs is NOT enough to change what this URL serves. You must also do
// Deploy > Manage deployments > pencil > New version > Deploy. The URL stays the
// same, which is why people believe they shipped when they did not.
const APPS_SCRIPT_URL = "";

// OAuth 2.0 Web Client ID. Must be byte-identical to CLIENT_ID in Code.gs.
// One client is reused across events. Its authorised JavaScript origins must
// cover wherever this app is served from. Origins ignore the path, so any repo
// under an already-authorised GitHub account works; anything else needs the
// origin added in the Cloud console first, or sign-in fails with origin_mismatch.
// The Cloud project is administered internally, so allow lead time if a new
// origin is needed. Do not create a project of your own.
const GOOGLE_CLIENT_ID = "";

/* ---- The event -------------------------------------------------------- */

const EVENT = {
  name: "",                    // shown in the header and in the follow-up subject line
  timezone: "Europe/Paris",    // must match appsscript.json

  /* Phases replace hardcoded dates.

     An event is a sequence of moments, and the right home screen is not the same
     in each. Early on, almost everyone you meet is in the file, so the list is the
     home screen. Later, almost nobody you meet is in the file, so free capture is
     the home screen and the list drops to second.

     Do not hardcode that flip to a date. Describe the phases and let the app read
     the clock.

       id        stable key, used in the Sheet's "Session / moment" column and by
                 the follow-up page to pick an opening line. Keep it short.
       label     what the user sees.
       from/to   local ISO datetime. Windows may overlap; the first match wins,
                 so declare the narrow ones (a dinner) before the wide ones (a day).
       home      "list" or "capture".
       tonight   true for a phase that shows a dedicated sub-list, typically a dinner.
                 End it after midnight, not at midnight: captures at a dinner get
                 logged late.

     Example shape, delete and replace:

       { id: "masterclass", label: "Masterclass",  from: "2026-09-16T08:00", to: "2026-09-16T18:00", home: "list",    tonight: false },
       { id: "dinner",      label: "Tonight",      from: "2026-09-16T14:00", to: "2026-09-17T03:00", home: "list",    tonight: true  },
       { id: "forum-1",     label: "Forum, day 1", from: "2026-09-17T00:00", to: "2026-09-17T23:59", home: "capture", tonight: false }
  */
  phases: [],

  // Writes are frozen a few days after the event. Export to HubSpot is a human job,
  // and a Sheet that keeps moving after the export is a Sheet nobody can reconcile.
  // Default: last day + 4.
  freezeWritesFrom: ""
};

/* ---- Who is who ------------------------------------------------------- */
/*
  One product for everyone. The role affects exactly two things:
    hasList  -> whether "assigned to me" is the default filter on open
    isTutor  -> whether the capture form shows the extra observation field

  Everything else is identical. Everyone sees and writes every record, and nothing
  is gated on this table: an email that is not listed still gets the full app, with
  no default filter, correctable from Settings.

  `name` is the SHORT name, because that is what lands in the "Met by" column and
  what is already written by hand in the ownership column. Consistency with the
  Sheet matters more than formality: both feed the post-event export.

  `ownerNames` are matched against the ownership column case-insensitively, as a
  substring, with accents stripped, because that column is filled by hand. Give
  first name and last name so that "Bertrand", "Bertrand J" and "bertrand julia"
  all resolve. Everyone gets ownerNames, including people with no assigned list,
  otherwise a dinner guest they personally brought shows up under someone else.

  Include whoever runs the onboarding session, even if they are not on the floor.
*/
const USERS = {
  // "first.last@deepip.ai": { name: "First", fullName: "First Last", role: "Sales", hasList: true, isTutor: false, ownerNames: ["first", "last"] },
};

/* ---- Capture form ----------------------------------------------------- */
/*
  This is not cosmetic. These five fields are the input contract of the follow-up
  page: `temperature`, `toolToday`, `nextStep` and the free-text hook are what the
  draft emails are written from. Change the picklists if the event calls for it,
  but keep the five fields.

  Keep every list short enough to be a single tap on a phone held in one hand,
  in a room, standing.
*/
const CAPTURE_OPTIONS = {
  met:         ["Yes", "No", "Not seen"],
  temperature: ["Hot", "Warm", "Cold", "Not a fit"],
  toolToday:   ["Nothing", "Built in-house", "Other", "Unknown"], // + COMPETITORS below
  nextStep:    ["Demo", "Intro", "Send content", "Nothing"],
  // Tutors only. One tap, no text: someone teaching all day will not type a sentence.
  observation: ["Engaged", "Asked a good question", "Already using a tool", "Stuck on something"]
};

// Naming the incumbent is often the only competitive signal an event produces, so
// the list is worth curating per event. Names only. Never annotate a competitor
// with an account, a deal or a number in this file.
const COMPETITORS = [];

/* ---- Sync and freshness ----------------------------------------------- */
/*
  The field lesson from Budapest: the plumbing was right and the labelling was
  wrong. One "Synced 4 min ago" line covered two states that users experience as
  completely different questions:

    outbound  are MY captures saved and gone up?
    inbound   is what I am READING up to date?

  Show them separately, in words rather than timestamps, and give a refresh control
  a thumb can find. A capture must appear in the user's own list instantly, from the
  queue, before it has reached the Sheet.
*/
const SYNC = {
  autoIntervalMs: 60000,          // background attempt while the app is open and visible
  requestTimeoutMs: 20000,        // a hung request must never block the queue
  snapshotStaleAfterMs: 15 * 60000, // after this, the inbound line says the list is old
  promptRefreshAfterMs: 30 * 60000  // after this, it becomes a banner, not a line
};

/* ---- Modules ---------------------------------------------------------- */
/*
  Off by default means the code path is not built at all, not hidden. Turning one
  on adds a screen and a set of interview questions (CLAUDE.md section 3).
*/
const MODULES = {
  dinner: false,   // dedicated sub-list and briefing page for a dinner
  rsvp: false,     // public registration form feeding the guest list
  followUp: true   // post-event draft emails, generated after the fact
};
