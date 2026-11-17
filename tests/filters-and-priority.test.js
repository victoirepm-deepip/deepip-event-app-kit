/*
 * Regression test for three defects found during the Paris build (Nov 2026).
 * No dependencies, no DOM, no network, no real contact data: `model.js` and
 * `ui.js` are string templates over plain objects, which is what makes this
 * possible at all.
 *
 *   node tests/filters-and-priority.test.js
 *
 * It builds its own throwaway configuration rather than reading `config.js`,
 * so it tests the engine and not whichever event is currently checked in.
 */
const fs = require("fs"), vm = require("vm"), path = require("path");
const ROOT = path.join(__dirname, "..");

/* A configuration that exercises the three fixes:
   - a chip with `match: "yes"`          (a yes/no column)
   - a chip with a value to match        (the bug: it was never compared)
   - a chip with no match at all         (the column holds anything)
   - letter grades AND a numeric one, plus unranked labels */
const CONFIG = `
const APPS_SCRIPT_URL = "", GOOGLE_CLIENT_ID = "";
const EVENT = {
  name: "Test event", slug: "test", timezone: "Europe/Paris",
  directoryLabel: "", engagementTrack: "",
  phases: [{ id: "day", label: "Day", from: "2026-11-19T08:00", to: "2026-11-20T02:00", home: "list" }],
  freezeWritesFrom: "2026-11-23T00:00"
};
const USERS = {
  "ae@deepip.ai": { name: "AE", fullName: "Ada Engel", role: "Sales", hasList: true, ownerNames: ["engel"] }
};
const OWNER_KEYS = ["ownership"];
const CAPTURE_OPTIONS = { met: ["Yes", "No"], temperature: ["Hot"], toolToday: [], nextStep: [] };
const CAPTURE_EXTRA = [];
const COMPETITORS = [];
const FOLLOW_UP = { sender: "metBy", fallbackSender: "metBy", cc: "", sendWithinHours: 24, signers: {}, moments: {} };
const CARD_FIELDS = [{ key: "population", label: "Guest of" }];
const LIST_FIELDS = [
  { key: "priority" },
  { key: "population", flag: "Partner guest", match: "partner guest" }
];
const LIST_FILTERS = [
  "notmet",
  { id: "ticked",  label: "Ticked",         key: "targetAccount", match: "yes" },
  { id: "partner", label: "Partner guests", key: "population",    match: "Partner guest" },
  { id: "stage",   label: "On stage",       key: "onStage",       match: "Panel" },
  { id: "anyowner", label: "Has an owner",  key: "ownership" }
];
const SYNC = { autoIntervalMs: 60000, requestTimeoutMs: 20000, snapshotStaleAfterMs: 900000, promptRefreshAfterMs: 1800000 };
const MODULES = { dinner: false, rsvp: false, followUp: true };
`;

const src = [CONFIG].concat(["model.js", "ui.js"].map(f => fs.readFileSync(path.join(ROOT, f), "utf8"))).join("\n");
const sandbox = {
  console, Intl, Date, encodeURIComponent, decodeURIComponent,
  history: { length: 1 }, location: { hash: "#/" },
  Sync: {
    state: { status: "online", authState: "ok", lastSyncAt: Date.now(), snapshotAt: Date.now(), pending: 0, lastError: null, frozen: false },
    isStale: () => false, statusText: () => "Synced just now"
  }
};
const ctxv = vm.createContext(sandbox);
vm.runInContext(src, ctxv);
const M = vm.runInContext("Model", ctxv);

let fails = 0, passes = 0;
const ok = (n, c) => { if (c) passes++; else { fails++; console.log("FAIL: " + n); } };

/* Invented people. Five of the six carry a population, so a chip that forgets
   to compare its value selects almost the whole room and looks like it works. */
const contacts = [
  { firstName: "Ada",  lastName: "Nouri",    firm: "Northwind", priority: "A",      population: "Partner guest", ownership: "Ada Engel",  targetAccount: "Yes", onStage: "Panel 2" },
  { firstName: "Bo",   lastName: "Svensson", firm: "Westvale",  priority: "B",      population: "Partner guest", ownership: "",           targetAccount: "No" },
  { firstName: "Cleo", lastName: "Marchand", firm: "Eastgate",  priority: "Host",   population: "Partner host",  ownership: "Ada Engel",  targetAccount: "" },
  { firstName: "Dag",  lastName: "Oyelaran", firm: "Southbank", priority: "2",      population: "Our guest",     ownership: "",           onStage: "Panel 10" },
  { firstName: "Eve",  lastName: "Kowalski", firm: "Midvale",   priority: "Vendor", population: "Vendor",        ownership: "Ada Engel" },
  { firstName: "Fay",  lastName: "Oduya",    firm: "Northgate", priority: "",       population: "",              ownership: "" }
];
const me = { email: "ae@deepip.ai", name: "AE", fullName: "Ada Engel", hasList: true, ownerNames: ["engel"] };
const index = M.indexEncounters([], contacts);
const ctx = { contacts, directory: [], encounters: [], index, firms: M.buildFirms(contacts), me };
const by = n => contacts.find(c => c.lastName === n);
const chip = id => M.availableFilters(ctx).find(f => f.id === id);
const selects = id => contacts.filter(chip(id).test).map(c => c.lastName);

/* ---- 1. a chip with a `match` value compares it ------------------------- */
ok("every configured chip is built",   M.availableFilters(ctx).length === 5);
ok("match value selects only matches", JSON.stringify(selects("partner")) === JSON.stringify(["Nouri", "Svensson"]));
ok("it does not select the whole room", selects("partner").length < contacts.filter(c => c.population).length);
ok("the host is not a guest",          selects("partner").indexOf("Marchand") === -1);
ok("match is a substring, so Panel finds Panel 2 and Panel 10",
   JSON.stringify(selects("stage")) === JSON.stringify(["Nouri", "Oyelaran"]));
ok("match is case- and accent-insensitive",
   chip("partner").test({ population: "PARTNER GUEST" }) === true);
ok("an empty cell matches nothing",    chip("partner").test({ population: "" }) === false);
ok("match: yes is still a tick test",  JSON.stringify(selects("ticked")) === JSON.stringify(["Nouri"]));
ok("no match still means 'has anything'",
   JSON.stringify(selects("anyowner")) === JSON.stringify(["Nouri", "Marchand", "Kowalski"]));
ok("a built-in chip named as a string still works", typeof chip("notmet").test === "function");

/* ---- 2. priority reads letters, numbers and labels ---------------------- */
ok("A ranks first",            M.priority(by("Nouri")).value === 1);
ok("B ranks second",           M.priority(by("Svensson")).value === 2);
ok("a number still ranks",     M.priority(by("Oyelaran")).value === 2);
ok("A is labelled A, not P1",  M.priorityLabel(by("Nouri")) === "A");
ok("2 is still labelled P2",   M.priorityLabel(by("Oyelaran")) === "P2");
ok("Host is unranked",         M.priority(by("Marchand")).value === null);
ok("Host still renders",       M.priorityLabel(by("Marchand")) === "Host");
ok("Vendor still renders",     M.priorityLabel(by("Kowalski")) === "Vendor");
ok("blank renders as nothing", M.priorityLabel(by("Oduya")) === "");
ok("the suggested fallback still outranks an unranked cell",
   M.priority({ priority: "CUSTOMER - do not pitch", suggestedPrio: "P2 warm" }).value === 2);
ok("and is still marked as suggested",
   M.priorityLabel({ priority: "", suggestedPrio: "P2 warm" }) === "P2 (suggested)");
ok("the one-line cell is ranked grades only",
   M.priorityShort(by("Nouri")) === "A" && M.priorityShort(by("Marchand")) === "");
ok("A sorts before B",
   M.sortContacts([by("Svensson"), by("Nouri")], ctx)[0].lastName === "Nouri");
ok("unranked sorts last", (() => {
  const order = M.sortContacts(contacts, ctx).map(c => c.lastName);
  return order.indexOf("Marchand") > order.indexOf("Svensson") &&
         order.indexOf("Oduya")    > order.indexOf("Svensson");
})());

/* ---- 3. a tag with flag + match is a label, not a repetition ------------ */
const UI = vm.runInContext("UI", ctxv);
const app = { ctx, me, view: { query: "", filters: [] } };
const rowOf = p => UI.personRow(p, app);
const guest = rowOf(by("Nouri")), host = rowOf(by("Marchand"));
ok("the matching row is tagged once",   (guest.match(/Partner guest/g) || []).length === 1);
ok("it is not printed as label: value", guest.indexOf("Partner guest: Partner guest") === -1);
ok("a non-matching row has no tag",     host.indexOf("Partner guest") === -1);
ok("the ranked grade is in the cell",   /row-prio[^>]*>A</.test(guest));
ok("and is not repeated as a tag",      (guest.match(/>A</g) || []).length === 1);
ok("an unranked label gets a tag",      /class="tag">Host</.test(host));
ok("no row leaks undefined",            guest.indexOf("undefined") === -1 && host.indexOf("undefined") === -1);

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
