/* DeepIP Event App Kit — configuration for AI & IP Summit USA 2026.
   Generated from the build brief (Notion, "Sales app build brief", 6 Oct 2026).
   See config.template.js for what every key means.

   Nothing in here is data: no contact names, no account names, no notes.
   The only people named are the DeepIP team in USERS (CLAUDE.md section 2). */

/* ---- Backend ---------------------------------------------------------- */

// Filled at deployment (CLAUDE.md section 6, step 7). Remember: editing Code.gs
// is not deploying it. Manage deployments > pencil > New version > Deploy.
const APPS_SCRIPT_URL = "";

// Shared DeepIP client, reused since Munich. Must be byte-identical to CLIENT_ID
// in Code.gs. Its authorised origins cover https://victoirepm-deepip.github.io and
// http://localhost:4173; anything else fails sign-in with origin_mismatch.
const GOOGLE_CLIENT_ID = "810262336028-7a92202r99cp09pv0s8gf5g5idsrer3u.apps.googleusercontent.com";

/* ---- The event -------------------------------------------------------- */

const EVENT = {
  name: "AI & IP Summit USA 2026",
  // Derives the IndexedDB name and the offline cache, so two events served from
  // one origin never share storage.
  slug: "aiipsummit26",
  // Bump on every deployment.
  shellVersion: 1,
  // Must equal timeZone in appsscript.json and the Sheet's File > Settings > Time zone.
  timezone: "America/New_York",

  // No second list: the Attendees List covers almost the whole registered
  // audience. The directory is empty (DIRECTORY_COLUMNS = {} in Code.gs).
  directoryLabel: "",
  // No product-engagement block at this event.
  engagementTrack: "",

  // The app covers 7 Oct only (decided 6 Oct): day 1 is out of scope. One phase,
  // list on top, because most booth visitors are in the file. Booth hours are
  // not known, so the window is the whole day.
  phases: [
    { id: "summit", label: "Summit", from: "2026-10-07T00:00", to: "2026-10-07T23:59", home: "list", tonight: false }
  ],

  // Last day + 4 (kit default).
  freezeWritesFrom: "2026-10-11T00:00"
};

/* ---- Who is who ------------------------------------------------------- */
/*
  Everyone sees and writes every record (not partitioned). Nobody is a tutor.

  Assignment lives in two columns of the Attendees List: `Company Owner` and
  `Prospecting SDR` (see OWNER_KEYS below). ownerNames are matched against both,
  so the SDR's rows land in his "Assigned to me" view as well as the owner's.

  Rows owned by people who are not on the floor stay under their owner's name
  and are visible to everyone once the "Assigned to me" chip is removed.
*/
const USERS = {
  "francois-xavier.leduc@deepip.ai": { name: "FX",           fullName: "François-Xavier Leduc", role: "Sales",       hasList: false, isTutor: false, ownerNames: ["francois-xavier", "leduc"] },
  "justin.stempel@deepip.ai":        { name: "Justin",       fullName: "Justin Stempel",        role: "Sales",       hasList: true,  isTutor: false, ownerNames: ["justin", "stempel"] },
  "konstantinos.parisis@deepip.ai":  { name: "Konstantinos", fullName: "Konstantinos Parisis",  role: "Sales",       hasList: true,  isTutor: false, ownerNames: ["konstantinos", "parisis"] },
  "thomas.chazot@deepip.ai":         { name: "Thomas",       fullName: "Thomas Chazot",         role: "Build owner", hasList: false, isTutor: false, ownerNames: ["thomas", "chazot"] }
};

// Contact keys read by "Assigned to me". `ownership` is `Company Owner`, `sdr` is
// `Prospecting SDR`. The "No owner" chip still reads `Company Owner` only.
const OWNER_KEYS = ["ownership", "sdr"];

/* ---- Capture form ----------------------------------------------------- */
/*
  Core fields are the follow-up generator's input contract. Write-tab headers:
  met -> `Met status`, temperature -> `Temperature`, toolToday -> `Tool today`,
  nextStep -> `Next step`, hook -> `Hook`. The tutor-only observation picklist
  is never shown: nobody is a tutor, and it has no column on the write tab.
*/
const CAPTURE_OPTIONS = {
  met:         ["Yes", "No", "Not seen"],
  temperature: ["Hot", "Warm", "Cold", "Not a fit"],
  toolToday:   ["Nothing", "Built in-house", "Other", "Unknown"], // + COMPETITORS below
  nextStep:    ["Demo", "Intro", "Send content", "Nothing"],
  observation: ["Engaged", "Asked a good question", "Already using a tool", "Stuck on something"] // tutors only: unused
};

/* Extra fields, from the brief. All optional: a capture is never blocked on one.
   Each header is frozen and has its entry in ENCOUNTER_COLUMNS in Code.gs. */
const CAPTURE_EXTRA = [
  {
    key: "practitioners",
    label: "How many practitioners at the firm?",
    header: "Practitioners",
    type: "number"
  },
  {
    key: "draftingModel",
    label: "Do they draft in-house or outsource?",
    header: "Drafting model",
    type: "choice",
    options: ["In-house", "Outsourced", "Mix", "Unknown"]
  },
  {
    key: "purchaseSignOff",
    label: "Who signs off on tool purchases?",
    header: "Tool purchase sign-off",
    type: "choice",
    options: ["GC / CLO", "Head of IP", "Partner / committee", "Procurement", "Unknown"]
  },
  {
    key: "otherTools",
    label: "What other tools do they use?",
    header: "Other tools",
    type: "text"
  },
  {
    // Follow-up generator input: only when the person is not on the list.
    key: "email",
    label: "Email (only if not on the list)",
    header: "Email",
    type: "text"
  },
  {
    // Decides the follow-up signer.
    key: "technicalField",
    label: "Technical field",
    header: "Technical field",
    type: "choice",
    options: ["Life sciences", "Chemistry", "Electrical / software", "Mechanical", "Mixed / unknown"]
  }
];

// Names only.
const COMPETITORS = ["Ankar", "Solve", "Patlytics", "Questel", "Tradespace"];

/* ---- Follow-up -------------------------------------------------------- */
/*
  One opening line per moment, keyed on phase id (the `Session / moment`
  column). The page is generated on 8 Oct; the copy is written then.
  The signer is decided by `Technical field`; until that mapping is set,
  the person who had the conversation (`Met by`) signs.
*/
const FOLLOW_UP = {
  sender: "metBy",
  sendWithinHours: 48,
  moments: {
    "summit": "booth at the AI & IP Summit"
  }
};

/* ---- Contact card ----------------------------------------------------- */
/* Attendee List columns shown on the card, in this order. Lifecycle is the
   engine's accountStatus; Lifecycle "Customer" raises the customer banner. */
const CARD_FIELDS = [
  { key: "ownership",        label: "Company owner", empty: "No owner" },
  { key: "sdr",              label: "Prospecting SDR" },
  { key: "accountStatus",    label: "Lifecycle" },
  { key: "tiering",          label: "Tiering" },
  { key: "openDeal",         label: "Has open or won deal" },
  { key: "targetAccount",    label: "Target account" },
  { key: "region",           label: "Region" },
  { key: "competitorClient", label: "Competitor's client" }
];

/* Tags under each row of the list. Yes/no columns show their short label only
   when yes. */
const LIST_FIELDS = [
  { key: "accountStatus" },
  { key: "openDeal",         flag: "Open/won deal" },
  { key: "targetAccount",    flag: "Target account" },
  { key: "competitorClient", flag: "Competitor's client" }
];

/* Filter chips on the list. No priority column in this Sheet, so no P1/P2/P3.
   `Competitor's client` holds a competitor's name, so "Using a competitor"
   means the cell is filled. */
const LIST_FILTERS = [
  "mine",
  "noowner",
  { id: "target",     label: "Target account",     key: "targetAccount",    match: "yes" },
  { id: "competitor", label: "Using a competitor", key: "competitorClient", match: "filled" },
  "customers"
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
  dinner off (no dinner, confirmed by Thomas), rsvp off (third-party event).
*/
const MODULES = {
  dinner: false,
  rsvp: false,
  followUp: true
};
