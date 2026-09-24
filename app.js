/* Bootstrap, routing and wiring.
 *
 * Boot order is the whole point: local data first, network second. The app is
 * fully rendered and fully usable before any request is made, and a failed
 * request changes the status line and nothing else.
 */

const App = {
  snapshot: null,
  pending: [],        // captures still in the queue — merged in so "met" is instant
  ctx: null,
  me: null,
  filters: [],
  query: "",
  draft: {},
  summaryDay: null,
  dateOverride: null,

  /* ---- clock ---------------------------------------------------------- */
  /* Injectable so the team can rehearse a later phase at the onboarding session.
     The override is an event-local "YYYY-MM-DDTHH:MM" from Model.previewMoments. */
  now() {
    if (!this.dateOverride) return new Date();
    const d = Model.eventTime(this.dateOverride);
    return isNaN(d.getTime()) ? new Date() : d;
  },

  /* ---- derived context ------------------------------------------------ */
  rebuild() {
    const snap = this.snapshot || { contacts: [], directory: [], encounters: [] };
    // Queued captures count as real. A rep who has just logged someone must see
    // them as met immediately, whether or not the Sheet has heard about it.
    const encounters = (snap.encounters || []).concat(this.pending || []);
    this.ctx = {
      contacts: snap.contacts || [],
      directory: snap.directory || [],
      encounters,
      index: Model.indexEncounters(encounters, snap.contacts || []),
      firms: Model.buildFirms(snap.contacts || []),
      me: this.me
    };
  },

  myListCount() {
    return this.ctx.contacts.filter(c => Model.isMine(c, this.me)).length;
  },
  dinnerCount() {
    return Model.dinnerGuests(this.ctx).length;
  },
  unmatchedCount() {
    return Model.unmatchedPeople(this.ctx.encounters, this.ctx.contacts).length;
  },

  /* ---- identity ------------------------------------------------------- */
  async resolveMe() {
    const identity = Auth.getIdentity() || {};
    const email = (identity.email || "").toLowerCase();
    const known = USERS[email] || { name: identity.name || email, role: "", hasList: false, isTutor: false, ownerNames: [] };
    const overrides = await Store.loadSettings();
    this.me = Object.assign({ email }, known, overrides.profile || {});
    this.dateOverride = overrides.dateOverride || null;
  },

  async saveProfile(patch) {
    this.me = Object.assign({}, this.me, patch);
    const s = await Store.loadSettings();
    await Store.saveSettings({ profile: Object.assign({}, s.profile, patch) });
  },

  /* ---- boot ----------------------------------------------------------- */
  async boot() {
    await Auth.boot();

    if (!Auth.hasIdentity()) {
      // First run only. See UI.signIn — this is the one blocking screen, and it
      // exists solely for the onboarding session before departure.
      document.getElementById("app").innerHTML = UI.signIn();
      Auth.renderSignInButton(document.getElementById("gbtn"));
      // Carry on in place, do not reload: the ID token from this sign-in lives in
      // memory only, and a reload threw it away. The app then had to ask Google
      // for a new one silently, which Safari on iOS does not answer, so the first
      // sync never ran and the list stayed empty on a phone.
      document.addEventListener("auth:changed", () => this.boot(), { once: true });
      return;
    }

    await this.resolveMe();
    this.snapshot = await Sync.hydrate();
    this.pending = await Store.queued();
    this.rebuild();

    // Default filter on open — a real, removable chip, never an implicit condition.
    this.filters = this.me.hasList ? ["mine"] : [];

    this.render();
    Sync.start();
    Sync.flush();               // background; the screen is already up

    window.addEventListener("hashchange", () => this.render());
    document.addEventListener("sync:changed", () => this.renderStatusOnly());
    document.addEventListener("data:changed", async () => {
      this.snapshot = await Store.loadSnapshot();
      this.pending = await Store.queued();
      this.rebuild();
      // A sync landing while someone is halfway through a capture must not throw
      // away what they have typed. The new data is already in ctx; the screen
      // catches up when they leave the form.
      if (location.hash.indexOf("#/capture") === 0) return;
      this.render({ scroll: false });
    });
    // A fresh token is the one thing that unblocks a stuck queue, so push
    // immediately rather than waiting for the next 60-second tick.
    document.addEventListener("auth:changed", () => {
      Sync.flush({ force: true });
      this.toast("Signed in. Sending what was waiting…");
    });
    setInterval(() => this.renderStatusOnly(), 30000); // keeps "the list as of 14:12" honest
  },

  /* ---- render --------------------------------------------------------- */
  /** `scroll` is false for a background refresh: a 60-second sync must not yank
   *  someone back to the top of a card they are reading. */
  render({ scroll = true } = {}) {
    const [, route, arg] = (location.hash || "#/").split("/");
    const key = arg ? decodeURIComponent(arg) : null;
    let body;
    switch (route) {
      case "list":     body = UI.list(this); break;
      case "person":   body = UI.person(this, key); break;
      case "firm":     body = UI.firm(this, key); break;
      case "search":   body = UI.searchScreen(this); break;
      case "capture":  body = UI.capture(this, key); break;
      case "tonight":  body = UI.tonight(this); break;
      case "summary":  body = UI.summary(this); break;
      case "onsite":   body = UI.onsite(this); break;
      case "settings": body = UI.settings(this); break;
      default:         body = UI.home(this);
    }
    const y = window.scrollY;
    document.getElementById("app").innerHTML = `<div id="status">${UI.renderStatus()}</div>${body}`;
    window.scrollTo(0, scroll ? 0 : y);
    const q = document.getElementById("q");
    if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
    // The way back in when the hour-long token has run out.
    if (route === "settings") Auth.renderSignInButton(document.getElementById("reauth"), { prompt: false });
  },

  /** The status line updates on its own clock; re-rendering the screen under a
   *  half-filled capture form would throw the user's work away. */
  renderStatusOnly() {
    const el = document.getElementById("status");
    if (el) el.innerHTML = UI.renderStatus();
  },

  toast(message) {
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = message;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  },

  /* ---- capture -------------------------------------------------------- */
  async saveCapture(key) {
    if (Sync.state.frozen) { this.toast("Writes are closed for this event."); return; }

    const contact = key ? this.ctx.contacts.find(x => Model.contactKey(x) === key) : null;
    const firstEl = document.getElementById("cap-first");
    const lastEl = document.getElementById("cap-last");
    const firmEl = document.getElementById("cap-firm");
    const hookEl = document.getElementById("cap-hook");

    // Names are stored split, never as one "full name" (CLAUDE.md section 2).
    const firstName = contact ? Model.clean(contact.firstName) : (firstEl ? firstEl.value.trim() : "");
    const lastName = contact ? Model.clean(contact.lastName) : (lastEl ? lastEl.value.trim() : "");
    const firm = contact ? Model.clean(contact.firm) : (firmEl ? firmEl.value.trim() : "");

    // Two required fields for an unknown, and only two: last name and firm. Code.gs
    // refuses a row with no last name, so it is checked here, while the form is
    // still on screen, rather than lost in the queue. Never force selection from a
    // list — most people met on site are on no list.
    if (!lastName || !firm) { this.toast("Last name and firm are both needed."); return; }

    const now = this.now();
    const fullName = [firstName, lastName].filter(Boolean).join(" ");
    const inDirectory = (this.ctx.directory || []).some(d =>
      Model.norm(d.fullName) === Model.norm(fullName));

    const encounter = {
      clientId: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()),
      capturedAt: new Date().toISOString(),
      session: Model.sessionId(now),
      metBy: this.me.name || this.me.email,
      firstName,
      lastName,
      firm,
      country: contact ? Model.clean(contact.country) : (this.draft.country || ""),
      role: contact ? Model.clean(contact.role) : "",
      inList: contact ? "Yes" : "No",
      inDirectory: inDirectory ? "Yes" : "No",
      met: this.draft.met || "",
      temperature: this.draft.temperature || "",
      toolToday: this.draft.toolToday || "",
      hook: hookEl ? hookEl.value.trim() : "",
      nextStep: this.draft.nextStep || "",
      captureMethod: contact ? "From the file" : (this.draft.source || "Typed on site"),
      observation: this.me.isTutor ? (this.draft.observation || "") : "",
      contactRef: contact ? Model.contactRef(contact) : ""
    };

    // Extra fields from CAPTURE_EXTRA. Choice fields live in the draft, typed ones
    // are read from their input. All optional.
    (typeof CAPTURE_EXTRA !== "undefined" ? CAPTURE_EXTRA : []).forEach(x => {
      const el = document.getElementById("cap-x-" + x.key);
      const v = x.type === "choice" ? (this.draft[x.key] || "") : (el ? el.value.trim() : "");
      if (v !== "") encounter[x.key] = v;
    });

    await Sync.capture(encounter);          // durable before anything else happens
    this.pending = await Store.queued();
    this.rebuild();
    this.draft = {};
    this.toast("Saved on this phone.");
    location.hash = contact ? `#/person/${encodeURIComponent(key)}` : "#/";
  }
};

/* ---- one delegated handler for the whole app --------------------------- */

document.addEventListener("click", async e => {
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const act = el.dataset.act;

  if (act === "resync") { e.preventDefault(); Sync.flush({ force: true }); return; }

  if (act === "filter")  { App.filters = App.filters.concat(el.dataset.id); App.render(); return; }
  if (act === "unfilter"){ App.filters = App.filters.filter(f => f !== el.dataset.id); App.render(); return; }
  if (act === "clearfilters") { App.filters = []; App.render(); return; }

  if (act === "opt") {
    App.draft[el.dataset.group] = App.draft[el.dataset.group] === el.dataset.value ? "" : el.dataset.value;
    // Repaint just this group so the hook text and the rest of the form survive.
    el.closest(".grp-opts").querySelectorAll(".opt").forEach(b =>
      b.classList.toggle("opt-on", b.dataset.value === App.draft[el.dataset.group]));
    return;
  }

  if (act === "save") {
    e.preventDefault();
    const [, , arg] = (location.hash || "").split("/");
    App.saveCapture(arg ? decodeURIComponent(arg) : null);
    return;
  }

  if (act === "dir") {
    // A directory hit pre-fills the unknown form. It is a convenience, never a gate.
    const split = splitName(el.dataset.name);
    App.draft = { firstName: split.firstName, lastName: split.lastName, firm: el.dataset.firm, country: el.dataset.country,
                  source: `From the ${Model.directoryLabel()}` };
    location.hash = "#/capture";
    return;
  }

  if (act === "day")     { App.summaryDay = el.dataset.day; App.render(); return; }

  if (act === "copy") {
    const text = document.querySelector(".recap").textContent;
    try {
      await navigator.clipboard.writeText(text);
      App.toast("Copied. Paste it in Slack.");
    } catch (err) {
      // Clipboard API needs a secure context and can be refused; select instead.
      const r = document.createRange();
      r.selectNodeContents(document.querySelector(".recap"));
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
      App.toast("Select-and-copy — the clipboard was blocked.");
    }
    return;
  }

  if (act === "preview") {
    App.dateOverride = el.dataset.day || null;
    await Store.saveSettings({ dateOverride: App.dateOverride });
    App.render();
    return;
  }

  if (act === "toggle-tutor") { await App.saveProfile({ isTutor: el.checked }); App.render(); return; }
  if (act === "toggle-list")  { await App.saveProfile({ hasList: el.checked }); App.filters = el.checked ? ["mine"] : []; App.render(); return; }
});

document.addEventListener("input", e => {
  if (e.target.id === "q") {
    App.query = e.target.value;
    document.getElementById("results").innerHTML = UI.searchResults(App);
    return;
  }
  if (e.target.id === "capq") {
    App.query = e.target.value;
    const r = Model.search(App.query, App.ctx);
    const box = document.getElementById("capresults");
    box.innerHTML = [...r.contacts.map(p => ({ name: Model.fullName(p), first: Model.clean(p.firstName), last: Model.clean(p.lastName), firm: Model.clean(p.firm), country: Model.clean(p.country) })),
                     ...r.directory.map(d => ({ name: d.fullName, firm: Model.clean(d.firm), country: Model.clean(d.country) }))]
      .slice(0, 12)
      .map(x => `<button class="row" data-act="prefill" data-name="${UI.esc(x.name)}"${x.last !== undefined ? ` data-first="${UI.esc(x.first)}" data-last="${UI.esc(x.last)}"` : ""} data-firm="${UI.esc(x.firm)}" data-country="${UI.esc(x.country)}">
          <span class="row-name">${UI.esc(x.name)}</span><span class="row-firm">${UI.esc(x.firm)}</span></button>`).join("")
      || `<p class="muted pad small">No match — just type the last name and firm above.</p>`;
  }
});

document.addEventListener("change", e => {
  if (e.target.dataset && e.target.dataset.act === "ownername") {
    App.saveProfile({ ownerNames: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })
       .then(() => App.render());
  }
});

// Prefill from the in-capture lookup without leaving the form.
document.addEventListener("click", e => {
  const el = e.target.closest('[data-act="prefill"]');
  if (!el) return;
  const fn = document.getElementById("cap-first"), ln = document.getElementById("cap-last");
  const f = document.getElementById("cap-firm");
  const split = el.dataset.last !== undefined
    ? { firstName: el.dataset.first, lastName: el.dataset.last }
    : splitName(el.dataset.name);
  if (fn) fn.value = split.firstName;
  if (ln) ln.value = split.lastName;
  if (f) f.value = el.dataset.firm;
  App.draft.country = el.dataset.country;
  App.draft.source = "Matched in search";
  App.toast("Filled in — check it and carry on.");
});

/**
 * A directory entry is often a single name cell. Prefilling the split form from it
 * is a guess — last word as the last name — so it is only ever a prefill the user
 * sees and corrects, never written as is without them looking at it.
 */
function splitName(full) {
  const words = String(full || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return { firstName: "", lastName: "" };
  return { firstName: words.slice(0, -1).join(" "), lastName: words[words.length - 1] };
}

/* ---- pull to refresh ---------------------------------------------------- */
/* Same as the Refresh button, for a thumb already on the list. Only from the very
   top of the page, so an ordinary scroll never triggers it. A refresh never
   repaints an open capture form (see data:changed in App.boot). */
(() => {
  let startY = null, pulled = false;
  window.addEventListener("touchstart", e => {
    startY = window.scrollY <= 0 && e.touches.length === 1 ? e.touches[0].clientY : null;
    pulled = false;
  }, { passive: true });
  window.addEventListener("touchmove", e => {
    if (startY !== null && e.touches[0].clientY - startY > 80) pulled = true;
  }, { passive: true });
  window.addEventListener("touchend", () => {
    if (pulled) { Sync.flush({ force: true }); App.toast("Refreshing the list…"); }
    startY = null; pulled = false;
  });
})();

/* ---- service worker ---------------------------------------------------- */

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {
      // No offline shell (http, private mode). The IndexedDB snapshot and queue
      // still work, so the app degrades to "needs the page loaded once per session".
    });
  });
}

window.addEventListener("DOMContentLoaded", () => {
  // The shell is generic; the event name comes from config.js.
  if (EVENT.name) document.title = `${EVENT.name} — Sales Field`;
  App.boot();
});
