/*
 * The engine, over invented people. No dependencies, no DOM, no network.
 *
 *   node tests/engine.test.js
 *
 * `model.js` is pure functions and `ui.js` is string templates over them, so
 * every screen can be rendered in a Node vm and read back as text. That is the
 * whole trick, and it is worth protecting: it is what lets a build be checked
 * on a laptop at midnight without a phone, a Sheet or a single real guest.
 *
 * It builds its own throwaway configuration rather than reading `config.js`, so
 * it tests the engine and not whichever event is currently checked in.
 *
 * Every person in this file is invented. Never put a real one here.
 */
const fs = require("fs"), vm = require("vm"), path = require("path");
const ROOT = path.join(__dirname, "..");

/* A two-phase event in Europe/Paris whose evening runs past midnight — the case
   that a naive "is it today?" test gets wrong, every time. */
const CONFIG = `
const APPS_SCRIPT_URL = "", GOOGLE_CLIENT_ID = "";
const EVENT = {
  name: "Test event", slug: "test", timezone: "Europe/Paris",
  directoryLabel: "the delegate list", engagementTrack: "",
  phases: [
    { id: "day",     label: "Day",     from: "2026-11-19T09:00", to: "2026-11-19T18:00", home: "list" },
    { id: "evening", label: "Evening", from: "2026-11-19T18:00", to: "2026-11-20T03:00", home: "capture", tonight: true }
  ],
  freezeWritesFrom: "2026-11-23T00:00"
};
const USERS = {
  "ae@deepip.ai": { name: "AE", fullName: "Ada Engel", role: "Sales", hasList: true, ownerNames: ["engel"] }
};
const OWNER_KEYS = ["ownership"];
const CAPTURE_OPTIONS = {
  met: ["Yes", "No", "Not seen"], temperature: ["Hot", "Warm", "Cold"],
  toolToday: ["Nothing", "Other"], nextStep: ["Demo", "Intro", "Nothing"]
};
const CAPTURE_EXTRA = [{ key: "aiStage", label: "Where are they with AI?", header: "AI stage", type: "choice", options: ["Exploring", "Piloting"] }];
const COMPETITORS = ["Ankar", "Solve"];
const FOLLOW_UP = { sender: "metBy", fallbackSender: "metBy", cc: "", sendWithinHours: 24, signers: {}, moments: {} };
const CARD_FIELDS = [{ key: "accountStatus", label: "Lifecycle stage" }, { key: "angle", label: "Objective", empty: "Not set yet" }];
const LIST_FIELDS = [{ key: "accountStatus" }];
const LIST_FILTERS = ["mine", "notmet", "p1", "p2", "p3", "customers", "multifirm"];
const SYNC = { autoIntervalMs: 60000, requestTimeoutMs: 20000, snapshotStaleAfterMs: 900000, promptRefreshAfterMs: 1800000 };
const MODULES = { dinner: false, rsvp: false, followUp: true };
`;

const src = [CONFIG].concat(["model.js", "ui.js"].map(f => fs.readFileSync(path.join(ROOT, f), "utf8"))).join("\n");
const SyncState = { status: "online", authState: "ok", lastSyncAt: Date.now(), snapshotAt: Date.now(), pending: 0, lastError: null, frozen: false };
const sandbox = {
  console, Intl, Date, encodeURIComponent, decodeURIComponent,
  history: { length: 1 }, location: { hash: "#/" },
  Sync: { state: SyncState, isStale: () => false, statusText: () => "Synced just now" }
};
const ctxv = vm.createContext(sandbox);
vm.runInContext(src, ctxv);
const M = vm.runInContext("Model", ctxv);
const UI = vm.runInContext("UI", ctxv);

let fails = 0, passes = 0;
const ok = (n, c) => { if (c) passes++; else { fails++; console.log("FAIL: " + n); } };

/* Paris is UTC+1 in November, so 19:00 local is 18:00Z. Writing the instants in
   UTC and the expectations in local time is the point: a phase boundary must be
   local to the EVENT, never to whatever timezone the laptop is in. */
const Z = s => new Date(s + "Z");

/* ---- 1. phases, and the night that crosses midnight -------------------- */
ok("before the event, no phase",   M.phaseFor(Z("2026-11-18T12:00:00")) === null);
ok("10:00 local is the day",       M.phaseFor(Z("2026-11-19T09:00:00")).id === "day");
ok("17:59 local is still the day", M.phaseFor(Z("2026-11-19T16:59:00")).id === "day");
/* `to` includes its own minute, so 18:00 is claimed by BOTH windows and the
   first DECLARED one wins. That is deliberate — it is what lets a dinner be
   declared before the day that contains it — and it is the kind of rule that
   is obvious in the code and invisible from a config file. */
ok("the end minute belongs to the window declared first",
                                   M.phaseFor(Z("2026-11-19T17:00:00")).id === "day");
ok("18:01 local is the evening",   M.phaseFor(Z("2026-11-19T17:01:00")).id === "evening");
ok("20:00 local is the evening",   M.phaseFor(Z("2026-11-19T19:00:00")).id === "evening");
ok("01:00 the NEXT morning is still the evening",
                                   M.phaseFor(Z("2026-11-20T00:00:00")).id === "evening");
ok("04:00 is past the end",        M.phaseFor(Z("2026-11-20T03:00:00")) === null);
ok("the session id follows the phase",
   M.sessionId(Z("2026-11-19T19:00:00")) === "evening" && M.sessionId(Z("2026-11-19T09:00:00")) === "day");
ok("a capture at 01:00 is stamped with the evening, not the next day's phase",
   M.sessionId(Z("2026-11-20T00:00:00")) === "evening");
ok("the phase label is the human one", M.phaseLabel(Z("2026-11-19T19:00:00")) === "Evening");
ok("tonight shows only in a tonight phase",
   M.showTonight(Z("2026-11-19T19:00:00")) === true && M.showTonight(Z("2026-11-19T09:00:00")) === false);
ok("home flips to capture in the evening",
   M.homeFlipped(Z("2026-11-19T19:00:00")) === true && M.homeFlipped(Z("2026-11-19T09:00:00")) === false);

/* ---- 2. people, encounters, met state ---------------------------------- */
const contacts = [
  { firstName: "Ada",  lastName: "Nouri",    firm: "Northwind", priority: "1", ownership: "Ada Engel", accountStatus: "Customer", angle: "" },
  { firstName: "Bo",   lastName: "Svensson", firm: "Northwind", priority: "2", ownership: "Ada Engel", accountStatus: "Lead" },
  { firstName: "Cleo", lastName: "Marchand", firm: "Eastgate",  priority: "1", ownership: "Someone Else", accountStatus: "Lead" },
  { firstName: "Dag",  lastName: "Oyelaran", firm: "Southbank", priority: "",  ownership: "", accountStatus: "" },
  { firstName: "Eve",  lastName: "Kowalski", firm: "Northwind", priority: "3", ownership: "Ada Engel", removed: "Yes" }
];
const me = { email: "ae@deepip.ai", name: "AE", fullName: "Ada Engel", role: "Sales", hasList: true, ownerNames: ["engel"] };
const encounters = [
  { firstName: "Ada", lastName: "Nouri", firm: "Northwind", metBy: "AE", met: "Yes", temperature: "Hot",
    nextStep: "Demo", hook: "drafting volume doubled", capturedAt: "2026-11-19T19:30:00Z", session: "evening", clientId: "e1" },
  { firstName: "Bo", lastName: "Svensson", firm: "Northwind", metBy: "AE", met: "No",
    capturedAt: "2026-11-19T19:40:00Z", session: "evening", clientId: "e2" },
  { firstName: "Zoe", lastName: "Harbour", firm: "Unlisted Ltd", metBy: "AE", met: "Yes",
    hook: "met at the bar", capturedAt: "2026-11-20T00:20:00Z", session: "evening", clientId: "e3" }
];
const index = M.indexEncounters(encounters, contacts);
const ctx = { contacts, directory: [], encounters, index, firms: M.buildFirms(contacts), me };
const by = n => contacts.find(c => c.lastName === n);

ok("a capture marks someone met",        M.isMet(by("Nouri"), index) === true);
ok('"No" does not mark someone met',     M.isMet(by("Svensson"), index) === false);
ok("no encounter means not met",         M.isMet(by("Marchand"), index) === false);
ok("the thread finds the capture",       M.threadFor(by("Nouri"), index).length === 1);
ok("the hook survives the round trip",   M.threadFor(by("Nouri"), index)[0].hook === "drafting volume doubled");
ok("someone not in the file is listed as unmatched",
   M.unmatchedPeople(encounters, contacts).some(p => p.fullName.indexOf("Harbour") > -1));
ok("and a listed person is not",
   !M.unmatchedPeople(encounters, contacts).some(p => p.fullName.indexOf("Nouri") > -1));

/* ---- 3. firms ---------------------------------------------------------- */
ok("three firms",                    ctx.firms.size === 3);
ok("Northwind has three people",     ctx.firms.get(M.norm("Northwind")).members.length === 3);
ok("a firm key is normalised",       !!ctx.firms.get(M.norm("NORTHWIND")));

/* ---- 4. assignment and filters ----------------------------------------- */
const chip = id => M.availableFilters(ctx).find(f => f.id === id);
ok("mine matches on the owner name",   chip("mine").test(by("Nouri")) === true);
ok("mine ignores someone else's",      chip("mine").test(by("Marchand")) === false);
ok("mine ignores an empty cell",       chip("mine").test(by("Oyelaran")) === false);
ok('a "Remove" tick takes a row off my list', chip("mine").test(by("Kowalski")) === false);
ok("notmet excludes the met one",      chip("notmet").test(by("Nouri")) === false);
ok("customers finds the customer",     chip("customers").test(by("Nouri")) === true);
ok("multifirm finds a firm sending several", chip("multifirm").test(by("Nouri")) === true);
ok("multifirm ignores a lone attendee",      chip("multifirm").test(by("Oyelaran")) === false);
ok("two chips narrow, they do not widen",
   M.applyFilters(contacts, ["mine", "notmet"], ctx).map(c => c.lastName).join() === "Svensson");
ok("p1, p2, p3 are alternatives to each other, not a narrowing",
   M.applyFilters(contacts, ["p1", "p2"], ctx).length === 3);
ok("no filter means everyone",         M.applyFilters(contacts, [], ctx).length === contacts.length);

/* ---- 5. order ---------------------------------------------------------- */
ok("priority sorts first",
   M.sortContacts(contacts, ctx).slice(0, 2).every(c => M.priority(c).value === 1));
ok("unprioritised sorts last",
   M.sortContacts(contacts, ctx).slice(-1)[0].lastName === "Oyelaran");
ok("notMetFirst puts the met one at the bottom",
   M.sortContacts(contacts, ctx, { notMetFirst: true }).slice(-1)[0].lastName !== "Nouri" ||
   M.sortContacts(contacts, ctx, { notMetFirst: true }).map(c => c.lastName).indexOf("Nouri") >
   M.sortContacts(contacts, ctx, { notMetFirst: true }).map(c => c.lastName).indexOf("Marchand"));

/* ---- 6. search --------------------------------------------------------- */
ok("search finds a surname",      M.search("nouri", ctx).contacts.some(r => r.lastName === "Nouri"));
ok("search finds a firm",         M.search("northwind", ctx).contacts.length === 3);
ok("search ignores case",         M.search("NOURI", ctx).contacts.some(r => r.lastName === "Nouri"));
ok("search matches an email too", M.search("northwind", ctx).contacts.length > 0);
/* One letter returns nothing on purpose: a single keystroke on a phone would
   otherwise redraw the whole room between every letter typed. */
ok("one letter finds nothing",    M.search("n", ctx).contacts.length === 0);
ok("nothing finds nothing",       M.search("", ctx).contacts.length === 0);
ok("a miss is a miss",            M.search("zzzzz", ctx).contacts.length === 0);
ok("search always answers in both halves",
   ["contacts", "directory"].every(k => Array.isArray(M.search("nouri", ctx)[k])));

/* ---- 7. every screen renders, and renders nothing broken ---------------- */
/* The three counters the screens ask App for, implemented the same way App
   implements them, so the home screen can be rendered without app.js. */
const app = {
  ctx, me, now: () => Z("2026-11-19T19:00:00"), view: { query: "", filters: [] },
  draft: {}, filters: [], query: "", summaryDay: null,
  myListCount()    { return this.ctx.contacts.filter(c => M.isMine(c, this.me)).length; },
  dinnerCount()    { return M.dinnerGuests(this.ctx).length; },
  unmatchedCount() { return M.unmatchedPeople(this.ctx.encounters, this.ctx.contacts).length; }
};
ok("my list counts the three I own, minus the removed one", app.myListCount() === 2);
ok("one person was met who is not in the file", app.unmatchedCount() === 1);
ok("the dinner module is off, so nobody is at one", app.dinnerCount() === 0);
const screens = {
  home:    () => UI.home(app),
  list:    () => UI.list(app),
  person:  () => UI.person(app, M.contactKey(by("Nouri"))),
  unfilled:() => UI.person(app, M.contactKey(by("Oyelaran"))),
  firm:    () => UI.firm(app, M.norm("Northwind")),
  search:  () => UI.searchScreen(app),
  capture: () => UI.capture(app, M.contactKey(by("Nouri"))),
  newPerson: () => UI.capture(app, null),
  tonight: () => UI.tonight(app),
  summary: () => UI.summary(app),
  onsite:  () => UI.onsite(app),
  settings:() => UI.settings(app),
  signIn:  () => UI.signIn()
};
Object.keys(screens).forEach(name => {
  let html = "";
  try { html = screens[name](); } catch (e) { fails++; console.log("FAIL: " + name + " threw " + e.message); return; }
  ok(name + " renders",               typeof html === "string" && html.length > 40);
  ok(name + " has no undefined",      html.indexOf("undefined") === -1);
  ok(name + " has no [object Object]", html.indexOf("[object Object]") === -1);
  ok(name + " has no empty template", html.indexOf("${") === -1);
});

/* A card whose optional columns are empty must show no empty labels. */
const bare = screens.unfilled();
ok("an unfilled card shows the configured empty text, not a blank label",
   bare.indexOf("Not set yet") > -1);
ok("an unfilled card does not print a label with nothing after it",
   bare.indexOf("Lifecycle stage</") === -1 || bare.indexOf("Lifecycle stage</dt><dd></dd>") === -1);

/* ---- 8. the freeze closes every write control --------------------------- */
const openSave = screens.capture();
ok("Save is live before the freeze", openSave.indexOf('data-act="save"') > -1 && !/data-act="save"[^>]*disabled/.test(openSave));
SyncState.frozen = true;
const shutSave = UI.capture(app, M.contactKey(by("Nouri")));
ok("Save is disabled after the freeze", /data-act="save"[^>]*disabled/.test(shutSave));
SyncState.frozen = false;

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
