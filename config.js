/* DeepIP Event App Kit — configuration for VPP Herbstfachtagung 2026.
   Generated from the build brief (Notion, "Sales app build brief", 19 Oct 2026).
   See config.template.js for what every key means.

   Nothing in here is data: no contact names, no account names, no notes.
   The only people named are the DeepIP team in USERS (CLAUDE.md section 2).

   This file is also published, unchanged, to the public deploy repo (hosting
   exception recorded in the brief, 19 Oct). It must therefore never carry a
   Sheet ID, an export or anything read from the Sheet. */

/* ---- Backend ---------------------------------------------------------- */

// Filled at deployment (CLAUDE.md section 6, step 7). Remember: editing Code.gs
// is not deploying it. Manage deployments > pencil > New version > Deploy.
const APPS_SCRIPT_URL = "";

// Shared DeepIP client, reused since Munich. Must be byte-identical to CLIENT_ID
// in Code.gs. Its authorised origins must cover the Pages origin of the deploy
// repo (confirmed by the build owner, 19 Oct) and http://localhost:4173.
const GOOGLE_CLIENT_ID = "810262336028-7a92202r99cp09pv0s8gf5g5idsrer3u.apps.googleusercontent.com";

/* ---- The event -------------------------------------------------------- */

const EVENT = {
  name: "VPP Herbstfachtagung 2026",
  // Derives the IndexedDB name and the offline cache, so two events served from
  // one origin never share storage.
  slug: "vpp-herbst-2026",
  // Bump on every deployment.
  shellVersion: 1,
  // Must equal timeZone in appsscript.json and the Sheet's File > Settings > Time zone.
  timezone: "Europe/Berlin",

  // No second list at this event: the Field guide is the organiser's final list.
  // The directory is empty (DIRECTORY_COLUMNS = {} in Code.gs).
  directoryLabel: "",
  // No product-engagement block at this event.
  engagementTrack: "",

  // From the brief. Narrow before wide: the first match wins. List on top in
  // every phase, because soliciting outside the booth is not allowed and almost
  // everyone met is a registered delegate. `ai-session` exists only to give the
  // follow-up its own opening line. The dinner is the organiser's, with no table
  // plan known to us, so no sub-list.
  phases: [
    { id: "dinner",     label: "Tonight",           from: "2026-10-22T18:00", to: "2026-10-23T03:00", home: "list", tonight: false },
    { id: "day-1",      label: "Conference, day 1", from: "2026-10-22T07:30", to: "2026-10-22T18:00", home: "list", tonight: false },
    { id: "ai-session", label: "AI session",        from: "2026-10-23T13:15", to: "2026-10-23T14:30", home: "list", tonight: false },
    { id: "day-2",      label: "Conference, day 2", from: "2026-10-23T03:00", to: "2026-10-23T23:59", home: "list", tonight: false }
  ],

  // Last day + 4 (kit default, confirmed in the brief).
  freezeWritesFrom: "2026-10-27T00:00"
};

/* ---- Who is who ------------------------------------------------------- */
/*
  Everyone sees and writes every record. Nobody has an assigned list (decided
  19 Oct): the app opens on the whole list with no default filter. The Field
  guide's Ownership column is information only. Nobody is a tutor.

  No additional user (brief, 19 Oct): an unlisted @deepip.ai email still gets
  the full app, and "Met by" then carries its email address.
*/
const USERS = {
  "celia.wei@deepip.ai":         { name: "Celia",    fullName: "Celia Wei",         role: "Sales", hasList: false, isTutor: false, ownerNames: ["celia", "wei"] },
  "matthias.hofmann@deepip.ai":  { name: "Matthias", fullName: "Matthias Hofmann",  role: "Sales", hasList: false, isTutor: false, ownerNames: ["matthias", "hofmann"] },
  "andreas.andersson@deepip.ai": { name: "Andreas",  fullName: "Andreas Andersson", role: "Sales", hasList: false, isTutor: false, ownerNames: ["andreas", "andersson"] }
};

// Contact keys read by "Assigned to me": the hand-filled `Ownership` column of
// the Field guide. Information only at this event; the chip is still offered.
const OWNER_KEYS = ["ownership"];

/* ---- Capture form ----------------------------------------------------- */
/*
  Core fields are the follow-up generator's input contract. Write-tab headers:
  met -> `Met status`, temperature -> `Temperature`, toolToday -> `Tool today`,
  nextStep -> `Next step`, hook -> `Hook`. The tutor-only observation field has
  its `Observation` column but is never shown: nobody is a tutor.
*/
const CAPTURE_OPTIONS = {
  met:         ["Yes", "No", "Not seen"],
  temperature: ["Hot", "Warm", "Cold", "Not a fit"],
  toolToday:   ["Nothing", "Built in-house", "Other", "Unknown"], // + COMPETITORS below
  nextStep:    ["Demo", "Intro", "Send content", "Nothing"],
  observation: ["Engaged", "Asked a good question", "Already using a tool", "Stuck on something"]
};

/* Extra fields, from the brief. All optional: a capture is never blocked on one.
   Each header is frozen and has its entry in ENCOUNTER_COLUMNS in Code.gs. */
const CAPTURE_EXTRA = [
  {
    key: "practitioners",
    label: "How many patent practitioners in the IP department?",
    header: "Practitioners",
    type: "number"
  },
  {
    // Decides the follow-up signer. Absent for anyone met outside the list.
    key: "technicalField",
    label: "Technical field",
    header: "Technical field",
    type: "choice",
    options: ["Life sciences", "Chemistry", "Electrical / software", "Mechanical", "Mixed / unknown"]
  },
  {
    // Follow-up generator input: only when the person is not on the list.
    key: "email",
    label: "Email (if not in the list)",
    header: "Email",
    type: "text"
  }
];

// Names only.
const COMPETITORS = ["Ankar", "Solve", "Patlytics", "Questel", "Tradespace"];

/* ---- Follow-up -------------------------------------------------------- */
/*
  One opening line per moment, keyed on phase id (the `Session / moment`
  column). Generated on Mon 26 Oct by followup.html, run locally, never
  committed and never published.

  Signer (kit default, brief 19 Oct): a patent attorney chosen by `Technical
  field`; the account owner (`Company owner`) goes in Cc. The attorney for each
  field goes in `signers` before the batch; a field with no signer, or a capture
  with no technical field, falls back to the person who had the conversation
  (`Met by`). Every draft is reviewed by hand before it is sent.
*/
const FOLLOW_UP = {
  sender: "technicalField",
  fallbackSender: "metBy",
  cc: "crmOwner",
  sendWithinHours: 72,
  signers: {
    // "Life sciences": "",
    // "Chemistry": "",
    // "Electrical / software": "",
    // "Mechanical": ""
  },
  moments: {
    "day-1":      "Thank you for stopping by our booth at the VPP Herbstfachtagung in Magdeburg.",
    "dinner":     "It was a pleasure to talk over dinner at the VPP Herbstfachtagung.",
    "ai-session": "Thank you for joining the conversation around the AI session at the VPP Herbstfachtagung.",
    "day-2":      "Thank you for stopping by our booth at the VPP Herbstfachtagung in Magdeburg."
  }
};

/* ---- Contact card ----------------------------------------------------- */
/* Field guide columns shown on the card, in this order. `Lifecycle stage` is
   the engine's accountStatus; "Customer" raises the customer banner. */
const CARD_FIELDS = [
  { key: "ownership",        label: "Ownership", empty: "No owner" },
  { key: "sdr",              label: "Prospecting SDR" },
  { key: "accountStatus",    label: "Lifecycle stage" },
  { key: "tiering",          label: "Tier" },
  { key: "targetAccount",    label: "Target account" },
  { key: "organizationType", label: "Organization type" },
  { key: "patentPortfolio",  label: "Patent portfolio" },
  { key: "practitioners",    label: "Practitioners on file" },
  { key: "city",             label: "City" }
];

/* Tags under each row of the list. Yes/no columns show their short label only
   when yes. */
const LIST_FIELDS = [
  { key: "accountStatus" },
  { key: "tiering" },
  { key: "targetAccount", flag: "Target account" }
];

/* Filter chips on the list. Priority comes from `Priority override`, falling
   back to `Computed priority`. */
const LIST_FILTERS = [
  "p1",
  "p2",
  "p3",
  "notmet",
  { id: "target", label: "Target account", key: "targetAccount", match: "yes" },
  "customers",
  "multifirm",
  "mine",
  "noowner"
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
  dinner off (organiser dinner, seats picked in the VPP app, no table plan),
  rsvp off (third-party event), follow-up on.
*/
const MODULES = {
  dinner: false,
  rsvp: false,
  followUp: true
};
