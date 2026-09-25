/* DeepIP Event App Kit — configuration for IPO Annual Meeting 2026.
   Generated from the build brief (Notion, "Sales app build brief", 23 Sept 2026).
   See config.template.js for what every key means.

   Nothing in here is data: no contact names, no account names, no notes.
   The only people named are the DeepIP team in USERS (CLAUDE.md section 2). */

/* ---- Backend ---------------------------------------------------------- */

// Filled at deployment (CLAUDE.md section 6, step 7). Remember: editing Code.gs
// is not deploying it. Manage deployments > pencil > New version > Deploy.
// Deployment "IPOAM26 v1", 23 Sept 2026.
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbywm0eLcgvoTWOsjelQ5Td0BJkknA-_XC1sfQep_A9rMRMrv5Vvl3QMJvWr7WxXqGFGwA/exec";

// Shared DeepIP client, reused since Munich. Must be byte-identical to CLIENT_ID
// in Code.gs. Its authorised origins cover https://victoirepm-deepip.github.io and
// http://localhost:4173; anything else fails sign-in with origin_mismatch.
const GOOGLE_CLIENT_ID = "810262336028-7a92202r99cp09pv0s8gf5g5idsrer3u.apps.googleusercontent.com";

/* ---- The event -------------------------------------------------------- */

const EVENT = {
  name: "IPO Annual Meeting 2026",
  // Derives the IndexedDB name and the offline cache, so two events served from
  // one origin never share storage.
  slug: "ipoam26",
  // Bump on every deployment.
  shellVersion: 6,
  // Must equal timeZone in appsscript.json and the Sheet's File > Settings > Time zone.
  timezone: "America/Toronto",

  // No second list: the main list is the full registration export, so search
  // covers it. The directory is empty (DIRECTORY_COLUMNS = {} in Code.gs).
  directoryLabel: "",
  // No product-engagement block at this event.
  engagementTrack: "",

  // First match wins, so the dinner is declared before the day windows.
  // Day windows are whole days by decision (reception start and hall closing
  // times ruled not relevant). Day boundaries sit at 03:00 so late-evening
  // captures stay on the day they happened.
  phases: [
    { id: "dinner",  label: "Steam Whistle dinner",         from: "2026-09-28T18:00", to: "2026-09-29T03:00", home: "list",    tonight: false },
    { id: "arrival", label: "Set-up and Welcome Reception", from: "2026-09-27T00:00", to: "2026-09-28T03:00", home: "list",    tonight: false },
    { id: "expo-1",  label: "Expo, day 1",                  from: "2026-09-28T03:00", to: "2026-09-28T23:59", home: "capture", tonight: false },
    { id: "expo-2",  label: "Expo, day 2",                  from: "2026-09-29T03:00", to: "2026-09-29T23:59", home: "capture", tonight: false },
    { id: "after",   label: "After the event",              from: "2026-09-30T00:00", to: "2026-10-02T23:59", home: "capture", tonight: false }
  ],

  // Last day + 4 (kit default).
  freezeWritesFrom: "2026-10-03T00:00"
};

/* ---- Who is who ------------------------------------------------------- */
/*
  Everyone sees and writes every record (not partitioned). Nobody is a tutor:
  a booth has no role that observes people working.

  hasList is yes only for people who own at least one row in `Company Owner`
  today, so nobody opens on an empty default view. Bryan and Taylor flip to
  true once ownership is handed to them (brief, open question 3).

  Adam Coquia matches on "coquia" / "adam c" only: the ownership column also
  holds another Adam, and a bare "adam" would pull those accounts in.

  Blank `Company Owner` is shown as "No owner", derived at read time. The
  app never writes to the ownership column.
*/
const USERS = {
  "bryan.strickland@deepip.ai": { name: "Bryan",   fullName: "Bryan Strickland", role: "Sales",       hasList: false, isTutor: false, ownerNames: ["bryan", "strickland"] },
  "taylor.grinney@deepip.ai":   { name: "Taylor",  fullName: "Taylor Grinney",   role: "Sales",       hasList: false, isTutor: false, ownerNames: ["taylor", "grinney"] },
  "tyra.laws@deepip.ai":        { name: "Tyra",    fullName: "Tyra Laws",        role: "Sales",       hasList: true,  isTutor: false, ownerNames: ["tyra", "laws"] },
  "gabriel.mahe@deepip.ai":     { name: "Gabriel", fullName: "Gabriel Mahé",     role: "Sales",       hasList: true,  isTutor: false, ownerNames: ["gabriel", "mahe"] },
  "justin.stempel@deepip.ai":   { name: "Justin",  fullName: "Justin Stempel",   role: "Sales",       hasList: true,  isTutor: false, ownerNames: ["justin", "stempel"] },
  "adam.coquia@deepip.ai":      { name: "Adam C",  fullName: "Adam Coquia",      role: "Sales",       hasList: true,  isTutor: false, ownerNames: ["coquia", "adam c"] },
  // Build owner, not on site. Runs onboarding. hasList false per the brief.
  "thomas.chazot@deepip.ai":    { name: "Thomas",  fullName: "Thomas Chazot",    role: "Build owner", hasList: false, isTutor: false, ownerNames: ["thomas", "chazot"] }
};

/* ---- Capture form ----------------------------------------------------- */
/*
  Core fields are the follow-up generator's input contract. The free-text hook,
  shown to everyone, is written to the `Observation` column (hook -> Observation
  in ENCOUNTER_COLUMNS). The tutor-only observation picklist below is never shown:
  nobody is a tutor, and it has no column on the write tab.
*/
const CAPTURE_OPTIONS = {
  met:         ["Yes", "No", "Not seen"],             // written to `Met status`
  temperature: ["Hot", "Warm", "Cold", "Not a fit"],
  toolToday:   ["Nothing", "Built in-house", "Other", "Unknown"], // + COMPETITORS below
  nextStep:    ["Demo", "Intro", "Send content", "Nothing"],
  observation: ["Engaged", "Asked a good question", "Already using a tool", "Stuck on something"] // tutors only: unused
};

/* Extra fields. One for this event, decided 23 Sept. Optional: a capture is
   never blocked on it. Not part of the follow-up draft contract, available to
   the follow-up page as context. */
const CAPTURE_EXTRA = [
  {
    key: "practitioners",
    label: "How many patent practitioners at the firm?",
    header: "Number of Practitioners",
    type: "choice",
    options: ["1–5", "6–20", "21–50", "51–100", "100+", "Unknown"]
  }
];

// Names only.
const COMPETITORS = ["Solve Intelligence", "Patlytics", "Qthena", "Ankar AI", "Questel", "Anaqua"];

/* ---- Follow-up -------------------------------------------------------- */
/*
  One opening line per moment, keyed on phase id (the `Session / moment`
  column). The copy itself is written when the page is generated (Wed 30 Sept).
  Sent by the AE who had the conversation (`Met by`), within 48h.
  `after` falls back to the booth line.
*/
const FOLLOW_UP = {
  sender: "metBy",
  sendWithinHours: 48,
  moments: {
    "arrival": "welcome reception",
    "expo-1":  "booth, day 1",
    "dinner":  "Steam Whistle dinner",
    "expo-2":  "booth, day 2",
    "after":   "booth"
  }
};

/* ---- Contact card ----------------------------------------------------- */
/* Attendee List columns shown on the card, in this order (asked 23 Sept).
   Lifecycle is the engine's accountStatus: listed here, it leaves the one-line
   summary. Lifecycle "Customer" still raises the customer banner. */
const CARD_FIELDS = [
  { key: "orgType",          label: "Organization type" },
  { key: "accountStatus",    label: "Lifecycle" },
  { key: "openDeal",         label: "Has open or won deal" },
  { key: "targetAccount",    label: "Target account" },
  { key: "competitor",       label: "Competitor" },
  { key: "competitorClient", label: "Competitor's client" }
];

/* Same six columns as tags under each row of the list (asked 23 Sept). Yes/no
   columns show their short label only when yes. */
const LIST_FIELDS = [
  { key: "orgType" },
  { key: "accountStatus" },
  { key: "openDeal",         flag: "Open/won deal" },
  { key: "targetAccount",    flag: "Target account" },
  { key: "competitor" },
  { key: "competitorClient", flag: "Competitor's client" }
];

/* ---- Sync and freshness ----------------------------------------------- */

const SYNC = {
  autoIntervalMs: 60000,
  requestTimeoutMs: 20000,
  snapshotStaleAfterMs: 15 * 60000,
  promptRefreshAfterMs: 30 * 60000
};

/* ---- Modules ---------------------------------------------------------- */
/*
  dinner is off: the Monday dinner is IPO's official reception, not hosted by
  DeepIP, with no guest list or seating plan, so there is no briefing page.
  No dinner sub-list either (decided 23 Sept): the dinner phase has
  tonight: false and there is no dinner column. The phase still stamps
  "dinner" in Session / moment, so the follow-up can open on it.
*/
const MODULES = {
  dinner: false,
  rsvp: false,
  followUp: true
};
