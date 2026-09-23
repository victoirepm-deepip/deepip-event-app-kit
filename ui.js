/* Screens and routing. Hash router, string templates, one delegated click handler.
 * No framework and no build step — the whole app has to be debuggable from a phone
 * on a bad connection in a corridor.
 */

const UI = (() => {

  /* ---- helpers --------------------------------------------------------- */

  const esc = s => String(s === null || s === undefined ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  const c = Model.clean;

  /** Renders a label/value pair only when there is a value. Empty stays empty. */
  const field = (label, value) => c(value)
    ? `<div class="field"><span class="field-l">${esc(label)}</span><span class="field-v">${esc(c(value))}</span></div>`
    : "";

  const chip = (text, kind = "") => `<span class="chip ${kind}">${esc(text)}</span>`;

  const screen = (title, body, opts = {}) => `
    <header class="bar">
      ${opts.back === false ? `<span class="bar-sp"></span>` : `<a class="bar-back" href="${esc(opts.back || "#/")}" aria-label="Back">‹</a>`}
      <h1>${esc(title)}</h1>
      <a class="bar-set" href="#/settings" aria-label="Settings">⚙</a>
    </header>
    <main>${body}</main>`;

  /* ---- status area ------------------------------------------------------
     On screen at all times. Two questions, answered separately, in words:

       outbound  are MY captures saved and gone up?
       inbound   is the list I am READING up to date?

     Two builds showed a single "Synced 4 min ago" line. People read it as "my
     captures are safe" and never realised the list in front of them was stale.
     Past SYNC.snapshotStaleAfterMs the inbound line says the list is old; past
     SYNC.promptRefreshAfterMs it becomes a banner. Refresh is one tap away, and
     pulling down does the same (app.js). */

  function outboundText(s) {
    if (!s.pending) return "All your captures are up.";
    const n = `${s.pending} capture${s.pending === 1 ? "" : "s"} waiting to go up.`;
    return s.status === "syncing" ? `${n} Sending…` : n;
  }

  function listTime(ts) {
    const d = new Date(ts);
    const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    return d.toDateString() === new Date().toDateString()
      ? time
      : `${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })}, ${time}`;
  }

  /** { text, level: fresh | stale | prompt } for what the user is reading. */
  function inbound(s, now = Date.now()) {
    if (!s.snapshotAt) return { text: "No list on this phone yet. Tap Refresh.", level: "prompt" };
    const age = now - s.snapshotAt;
    const t = listTime(s.snapshotAt);
    if (age > SYNC.promptRefreshAfterMs) {
      return { text: `The list on this phone is from ${t}. Tap Refresh to get the latest.`, level: "prompt" };
    }
    if (Sync.isStale(now)) return { text: `You are seeing the list as of ${t}. That is old: pull down or tap Refresh.`, level: "stale" };
    return { text: `You are seeing the list as of ${t}. Pull down to refresh.`, level: "fresh" };
  }

  function renderStatus() {
    const s = Sync.state;
    const bad = s.status === "offline" || s.status === "idle";
    const inb = inbound(s);
    const stale = inb.level !== "fresh" ? " stale" : "";
    return `
      <div class="status ${bad ? "status-off" : "status-on"}${stale}">
        <span class="dot"></span>
        <span class="status-lines">
          <span class="status-out${s.pending ? " status-out-waiting" : ""}">${esc(outboundText(s))}</span>
          ${inb.level === "prompt" ? "" : `<span class="status-in">${esc(inb.text)}</span>`}
        </span>
        <button class="resync" data-act="resync" ${s.status === "syncing" ? "disabled" : ""}>${s.status === "syncing" ? "…" : "Refresh"}</button>
      </div>
      ${inb.level === "prompt" ? `<div class="banner-refresh">${esc(inb.text)} <button class="banner-link" data-act="resync">Refresh now</button></div>` : ""}
      ${s.authState === "stale" && bad ? `<div class="banner-offline">Working offline — nothing is lost, everything you log is saved on this phone. ${s.pending ? `<a class="banner-link" href="#/settings">${s.pending} waiting: tap to reconnect</a>` : `<a class="banner-link" href="#/settings">Still offline? Tap to reconnect</a>`}</div>` : ""}
      ${s.frozen ? `<div class="banner-frozen">Writes are closed for this event. The app is read-only.</div>` : ""}`;
  }

  /* ---- home -------------------------------------------------------------
     Four entries, full width. The order follows the current phase: in a
     "capture" phase "Log a meeting" moves to the top and the list drops to
     second, because by then almost nobody you meet is in the file. Not a
     setting: EVENT.phases in config.js. */

  function home(app) {
    const now = app.now();
    const me = app.me;
    const listLabel = me.hasList ? "My list" : "Everyone";
    const listSub = me.hasList
      ? `${app.myListCount()} assigned to you`
      : `${app.ctx.contacts.length} people, not-yet-met first`;

    const entries = {
      list:    { href: "#/list",    title: listLabel,      sub: listSub,                                  glyph: "≡" },
      search:  { href: "#/search",  title: "Who is this?", sub: app.ctx.directory.length ? `Search the room and the ${Model.directoryLabel()}` : "Search the room", glyph: "?" },
      capture: { href: "#/capture", title: "Log a meeting", sub: "Works for someone who exists nowhere",   glyph: "+" },
      tonight: { href: "#/tonight", title: "Tonight",      sub: `${app.dinnerCount()} at the dinner`,      glyph: "◆" }
    };

    const order = Model.homeFlipped(now)
      ? ["capture", "list", "search"]
      : ["list", "search", "capture"];
    if (Model.showTonight(now)) order.push("tonight");

    const cards = order.map(k => {
      const e = entries[k];
      return `<a class="home-card home-${k}" href="${e.href}">
        <span class="home-glyph">${e.glyph}</span>
        <span class="home-body"><strong>${esc(e.title)}</strong><small>${esc(e.sub)}</small></span>
      </a>`;
    }).join("");

    return `
      <header class="bar bar-home">
        <h1>${esc(EVENT.name)}</h1>
        <a class="bar-set" href="#/settings" aria-label="Settings">⚙</a>
      </header>
      <main>
        <p class="home-hello">${esc(me.name || me.email)} · ${esc(Model.phaseLabel(now))}</p>
        ${cards}
        ${app.unmatchedCount() ? `<a class="home-secondary" href="#/onsite">Logged on site — ${app.unmatchedCount()} not in the file</a>` : ""}
        <a class="home-secondary" href="#/summary">Day summary — copy for Slack</a>
      </main>`;
  }

  /* ---- list -------------------------------------------------------------
     One list, one set of filters, same for everyone. Active filters are chips
     with a cross. The default filter is a real, removable chip — never an
     implicit condition. Tap the cross and you see all 100. */

  function list(app) {
    const all = Model.availableFilters(app.ctx);
    const active = app.filters;
    const rows = Model.sortContacts(
      Model.applyFilters(app.ctx.contacts, active, app.ctx),
      app.ctx,
      { notMetFirst: !app.me.hasList || active.indexOf("mine") === -1 }
    );

    const activeChips = active.map(id => {
      const f = all.find(x => x.id === id);
      return f ? `<button class="chip chip-active" data-act="unfilter" data-id="${esc(id)}">${esc(f.label)} <span class="x">×</span></button>` : "";
    }).join("");

    const available = all.filter(f => active.indexOf(f.id) === -1)
      .map(f => `<button class="chip chip-add" data-act="filter" data-id="${esc(f.id)}">${esc(f.label)}</button>`).join("");

    return screen(app.me.hasList ? "My list" : "Everyone", `
      <div class="filters">
        <div class="filters-active">
          ${activeChips || `<span class="filters-none">No filter — all ${app.ctx.contacts.length} people</span>`}
          ${active.length ? `<button class="chip chip-clear" data-act="clearfilters">Clear all</button>` : ""}
        </div>
        <details class="filters-more">
          <summary>Add a filter</summary>
          <div class="filters-avail">${available}</div>
        </details>
      </div>
      <p class="count">${rows.length} shown</p>
      ${rows.length ? rows.map(p => personRow(p, app)).join("") : emptyList(app, active)}
    `);
  }

  /** Level 1. One line, one line only: name, firm, priority chip, one flag icon. */
  function personRow(p, app) {
    const flag = Model.topFlag(p);
    const prio = Model.priority(p).value;
    const met = Model.isMet(p, app.ctx.index);
    // The first line is one line and stays one line: five fixed grid cells, no
    // wrapping. An event can add a second line of tags (LIST_FIELDS in config.js);
    // with none configured, or none filled for this person, the row is one line.
    const tags = listTags(p);
    return `<a class="row ${met ? "row-seen" : ""}${tags ? " row-2l" : ""}" href="#/person/${encodeURIComponent(Model.contactKey(p))}">
      <span class="row-flag ${flag ? "flag-" + flag.key : ""}" title="${flag ? esc(flag.label) : ""}">${flag ? flag.icon : ""}</span>
      <span class="row-name">${esc(Model.fullName(p))}</span>
      <span class="row-firm">${esc(c(p.firm))}</span>
      <span class="row-prio ${prio ? "p" + prio : ""}">${prio ? "P" + prio : ""}</span>
      <span class="row-check" title="${met ? "Met" : "Not yet met"}">${met ? "✓" : ""}</span>
      ${tags}
    </a>`;
  }

  /**
   * The second line of a list row, from LIST_FIELDS. A field with `flag` is a
   * yes/no column: it shows its short label when the cell says yes, and nothing
   * otherwise. Any other field shows its value. Empty stays empty.
   */
  const YES = /^(yes|y|true|1|x|oui)$/i;
  const NO = /^(no|n|false|0|non)$/i;
  function listTags(p) {
    const fields = typeof LIST_FIELDS !== "undefined" ? LIST_FIELDS : [];
    const bits = fields.map(f => {
      const v = c(p[f.key]);
      if (!v || NO.test(v)) return "";
      if (f.flag) return YES.test(v) ? `<span class="tag tag-flag">${esc(f.flag)}</span>` : `<span class="tag">${esc(f.flag)}: ${esc(v)}</span>`;
      return `<span class="tag">${esc(v)}</span>`;
    }).filter(Boolean);
    return bits.length ? `<span class="row-tags">${bits.join("")}</span>` : "";
  }

  function emptyList(app, active) {
    // The most likely reason on the morning of day one: nobody has filled the
    // ownership column yet. Say so, rather than showing a blank screen.
    if (active.indexOf("mine") > -1) {
      return `<div class="empty">
        <p>Nothing is assigned to you yet.</p>
        <p class="muted">The ownership column in the Sheet is what feeds this. Remove the “Assigned to me” chip above to see everyone.</p>
      </div>`;
    }
    return `<div class="empty"><p>No one matches these filters.</p></div>`;
  }

  /* ---- person card ------------------------------------------------------
     Five blocks, no more. The test for every field: does it help decide whether
     to approach, and with what opening line? If not, it drops a level.
     Deliberately absent: CSM sentiment, HubSpot id, LinkedIn, country. */

  function person(app, key) {
    const p = app.ctx.contacts.find(x => Model.contactKey(x) === key);
    if (!p) return screen("Not found", `<div class="empty"><p>That person is not in the local copy.</p></div>`);

    const f = Model.flags(p);
    const mates = Model.firmMates(p, app.ctx.firms);
    const thread = Model.threadFor(p, app.ctx.index);
    const eng = Model.engagement(p);
    const prio = Model.priorityLabel(p);

    /* 1 — the banner. Full width, customers only. A chip is not enough for a
       screen read while walking. Some customer accounts are not happy ones, so
       the wording must not imply a happy customer. Names a role, not a person:
       the banner outlives whoever holds the account today. */
    const banner = f.customer
      ? `<div class="banner-customer">CUSTOMER — do not pitch. Talk to the CSM first.</div>`
      : (f.doNotPitch ? `<div class="banner-nopitch">Do not pitch. Relationship, not pipeline.</div>` : "");

    /* 2 — who they are */
    const who = `
      <section class="block block-who">
        <h2 class="name">${esc(Model.fullName(p))}</h2>
        <p class="sub">${[c(p.role), c(p.firm)].filter(Boolean).map(esc).join(" · ")}</p>
        ${mates.length ? `<p class="firmcount"><a href="#/firm/${encodeURIComponent(Model.norm(p.firm))}">${mates.length + 1} people from this firm are here</a></p>` : ""}
        ${f.dinner ? `<p class="dinner-line">At the dinner${Model.inviterOf(p) ? ` — guest of ${esc(Model.inviterOf(p))}` : ""}</p>` : ""}
      </section>`;

    /* 3 — why they matter. One line. */
    const cardFields = typeof CARD_FIELDS !== "undefined" ? CARD_FIELDS : [];
    const onCard = new Set(cardFields.map(f => f.key));
    const why = [prio, onCard.has("accountStatus") ? "" : c(p.accountStatus),
                 onCard.has("tiering") ? "" : c(p.tiering)].filter(Boolean);
    const matter = why.length
      ? `<section class="block block-why"><p>${why.map(esc).join(" · ")}</p></section>` : "";

    /* 3b — event-specific columns (CARD_FIELDS in config.js). Label: value,
       only the ones with a value. */
    const glanceRows = cardFields.map(f => field(f.label, p[f.key])).join("");
    const glance = glanceRows ? `<section class="block block-glance">${glanceRows}</section>` : "";

    /* 4 — what to say. The main block; it gets the room.
       Precedence lives in Model.whatToSay so it can be tested: the prepared
       field note ("Context I have / Notes") first, the rep's own objective
       ("My objective") second, a written opening only when both are empty. */
    const say = Model.whatToSay(p);
    const whatToSay = `
      <section class="block block-say">
        <h3>${esc(say.label)}</h3>
        <p class="say${say.prepared ? "" : " say-empty"}">${esc(say.text)}</p>
      </section>`;

    /* 5 — one button */
    const action = `<a class="btn btn-primary" href="#/capture/${encodeURIComponent(key)}">Log a meeting</a>`;

    /* Level 3 — collapsed */
    const account = `
      <details class="lvl3"><summary>Account</summary>
        ${field("Owner", p.crmOwner)}
        ${field("ARR", p.arr)}
        ${field("Client reference", p.clientRef)}
        ${c(p.crmRecord) ? `<div class="field"><span class="field-l">CRM</span><a class="field-v link" href="${esc(c(p.crmRecord))}" target="_blank" rel="noopener">Open record</a></div>` : ""}
        ${field("Seniority", p.seniority)}
        ${field("Technical field", p.technicalField)}
      </details>`;

    const engagementBlock = eng ? `
      <details class="lvl3"><summary>Engagement on DeepIP</summary>
        ${eng.noAccount
          ? `<p class="noaccount">No product account</p>`
          : `${field("Projects created", eng.projects)}
             ${field("Conversations", eng.conversations)}
             ${field("Last CRM contact", eng.lastCrm)}
             ${field("Level", eng.level)}
             ${eng.signal ? `<p class="signal">${esc(eng.signal)}</p>` : ""}`}
        <p class="internal">Internal signal — do not mention in conversation.</p>
      </details>` : "";

    const firmBlock = mates.length ? `
      <details class="lvl3"><summary>Firm — ${esc(c(p.firm))}</summary>
        ${mates.map(m => `<a class="mate" href="#/person/${encodeURIComponent(Model.contactKey(m))}">
            <span>${esc(Model.fullName(m))}</span>
            <small>${Model.isMet(m, app.ctx.index) ? "met" : "not met"}</small>
          </a>`).join("")}
      </details>` : "";

    /* The thread. A person can legitimately be met several times by several
       people. Every capture is a new row; nothing is ever overwritten. */
    const threadBlock = thread.length ? `
      <section class="block block-thread">
        <h3>Met ${thread.length} time${thread.length === 1 ? "" : "s"}</h3>
        ${thread.map(encounterLine).join("")}
      </section>` : "";

    return screen("", banner + who + matter + glance + whatToSay + action + threadBlock +
                      account + engagementBlock + firmBlock,
                  { back: history.length > 1 ? "#/list" : "#/" });
  }

  function encounterLine(e) {
    // Event-local time: capturedAt is UTC, and showing it raw puts a Toronto
    // capture four hours in the future.
    const when = Model.whenOf(e.capturedAt || e.date);
    const bits = [c(e.temperature), c(e.toolToday), c(e.nextStep)].filter(Boolean);
    return `<div class="enc">
      <div class="enc-head"><strong>${esc(c(e.metBy) || "—")}</strong><span>${esc(when)}${c(e.session) ? " · " + esc(Model.sessionDisplay(e.session)) : ""}</span></div>
      ${c(e.hook) ? `<p class="enc-hook">${esc(c(e.hook))}</p>` : ""}
      ${bits.length ? `<p class="enc-bits">${bits.map(b => chip(b)).join("")}</p>` : ""}
      ${c(e.observation) ? `<p class="enc-obs">${esc(c(e.observation))}</p>` : ""}
    </div>`;
  }

  /* ---- firm ------------------------------------------------------------- */

  function firm(app, key) {
    const g = app.ctx.firms.get(key);
    if (!g) return screen("Firm", `<div class="empty"><p>Unknown firm.</p></div>`);
    const met = g.members.filter(m => Model.isMet(m, app.ctx.index)).length;
    return screen(g.name, `
      <p class="count">${g.members.length} here, ${met} met</p>
      ${Model.sortContacts(g.members, app.ctx, { notMetFirst: true }).map(p => personRow(p, app)).join("")}
    `, { back: "#/list" });
  }

  /* ---- search ----------------------------------------------------------- */

  function searchScreen(app) {
    return screen("Who is this?", `
      <input class="search" id="q" type="search" inputmode="search" autocomplete="off"
             placeholder="Name or firm" value="${esc(app.query)}" />
      <div id="results">${searchResults(app)}</div>
      <a class="btn btn-ghost" href="#/capture">Not here — log them as a new person</a>
    `);
  }

  function searchResults(app) {
    if (Model.norm(app.query).length < 2) {
      return `<p class="muted pad">Type two letters. The room first${app.ctx.directory.length ? `, then the ${esc(Model.directoryLabel())}` : ""}.</p>`;
    }
    const r = Model.search(app.query, app.ctx);
    if (!r.contacts.length && !r.directory.length) {
      return `<div class="empty"><p>No match.</p><p class="muted">That is normal — most people you meet on site are on no list. Log them as a new person.</p></div>`;
    }
    return `
      ${r.contacts.length ? `<h3 class="sec">In the room (${r.contacts.length})</h3>${r.contacts.map(p => personRow(p, app)).join("")}` : ""}
      ${r.directory.length ? `<h3 class="sec">${esc(Model.directoryLabel().replace(/^./, ch => ch.toUpperCase()))} (${r.directory.length})</h3>
        ${r.directory.map(d => `<button class="row row-dir" data-act="dir" data-name="${esc(d.fullName)}" data-firm="${esc(d.firm)}" data-country="${esc(d.country)}">
            <span class="row-name">${esc(d.fullName)}</span>
            <span class="row-firm">${esc([c(d.firm), c(d.city)].filter(Boolean).join(" · "))}</span>
            <span class="row-prio">${c(d.targetAccount) ? "target" : ""}</span>
          </button>`).join("")}` : ""}`;
  }

  /* ---- capture ----------------------------------------------------------
     Five fields. Four as thumb-sized button groups, one short text. No dictation.
     Tutors get one extra field, one tap, no text — same form, same row, own column.

     The unknown-person path is the top of this screen, not a dead end reached
     after a failed search: it is the most-used path across the three days. */

  function capture(app, key) {
    const p = key ? app.ctx.contacts.find(x => Model.contactKey(x) === key) : null;
    const draft = app.draft;

    const header = p
      ? `<div class="cap-who">
           <strong>${esc(Model.fullName(p))}</strong>
           <small>${esc([c(p.role), c(p.firm)].filter(Boolean).join(" · "))}</small>
         </div>`
      : `<div class="cap-new">
           <label>First name<input id="cap-first" type="text" autocomplete="off" value="${esc(draft.firstName || "")}" placeholder="First name" /></label>
           <label>Last name<input id="cap-last" type="text" autocomplete="off" value="${esc(draft.lastName || "")}" placeholder="Last name" /></label>
           <label>Firm<input id="cap-firm" type="text" autocomplete="off" value="${esc(draft.firm || "")}" placeholder="Their firm" /></label>
           <p class="muted small">Last name and firm are all that is required. A card read in a noisy room sometimes gives only a surname: that is enough. A directory search is a convenience, never a gate.</p>
           <details class="cap-find"><summary>Look them up (optional)</summary>
             <input class="search" id="capq" type="search" placeholder="Search the room or the directory" autocomplete="off" />
             <div id="capresults"></div>
           </details>
         </div>`;

    const group = (name, options, value, label) => `
      <fieldset class="grp" data-group="${name}">
        <legend>${esc(label || groupLabel(name))}</legend>
        <div class="grp-opts">
          ${options.map(o => `<button type="button" class="opt ${value === o ? "opt-on" : ""}" data-act="opt" data-group="${name}" data-value="${esc(o)}">${esc(o)}</button>`).join("")}
        </div>
      </fieldset>`;

    return screen(p ? "Log a meeting" : "Log someone new", `
      ${header}
      ${group("met", CAPTURE_OPTIONS.met, draft.met)}
      ${group("temperature", CAPTURE_OPTIONS.temperature, draft.temperature)}
      ${group("toolToday", CAPTURE_OPTIONS.toolToday, draft.toolToday)}
      <label class="hook">Hook — the thing to reuse in the follow-up
        <textarea id="cap-hook" rows="3" placeholder="One line you will be glad you wrote">${esc(draft.hook || "")}</textarea>
      </label>
      ${group("nextStep", CAPTURE_OPTIONS.nextStep, draft.nextStep)}
      ${app.me.isTutor ? group("observation", CAPTURE_OPTIONS.observation, draft.observation) : ""}
      ${(typeof CAPTURE_EXTRA !== "undefined" ? CAPTURE_EXTRA : []).map(x => extraField(x, draft)).join("")}
      <button class="btn btn-primary" data-act="save" ${Sync.state.frozen ? "disabled" : ""}>Save</button>
      <p class="muted small pad">Saved on this phone first. It reaches the Sheet on its own, even if you are offline now.</p>
    `, { back: p ? `#/person/${encodeURIComponent(key)}` : "#/" });
  }

  /* Extra fields, per event, from CAPTURE_EXTRA in config.js. Rendered after the
     core fields, in declaration order. Each one is optional: a capture is never
     blocked on an extra. */
  function extraField(x, draft) {
    const v = draft[x.key] === undefined || draft[x.key] === null ? "" : draft[x.key];
    if (x.type === "choice") {
      return `
      <fieldset class="grp" data-group="${esc(x.key)}">
        <legend>${esc(x.label)}</legend>
        <div class="grp-opts">
          ${(x.options || []).map(o => `<button type="button" class="opt ${v === o ? "opt-on" : ""}" data-act="opt" data-group="${esc(x.key)}" data-value="${esc(o)}">${esc(o)}</button>`).join("")}
        </div>
      </fieldset>`;
    }
    const type = x.type === "number" ? `type="number" inputmode="numeric" min="0"` : `type="text"`;
    return `<label class="extra">${esc(x.label)}
        <input id="cap-x-${esc(x.key)}" ${type} autocomplete="off" value="${esc(v)}" />
      </label>`;
  }

  const groupLabel = n => ({
    met: "Met", temperature: "Temperature", toolToday: "Tool today",
    nextStep: "Next step", observation: "What you saw (tutor)"
  })[n] || n;

  /* ---- tonight ----------------------------------------------------------
     Only during a phase flagged `tonight`. Guests are often invited by people
     who are not on site and hosted by people who are, so the inviter has to be
     on every card: the evening's captures go back to each inviter in a named
     export. */

  function tonight(app) {
    const guests = Model.dinnerGuests(app.ctx);
    if (!guests.length) {
      return screen("Tonight", `<div class="empty">
        <p>No one is flagged for the dinner yet.</p>
        <p class="muted">The dinner column in the Sheet feeds this.</p></div>`);
    }
    const byInviter = new Map();
    guests.forEach(g => {
      const k = Model.inviterOf(g) || "No inviter recorded";
      if (!byInviter.has(k)) byInviter.set(k, []);
      byInviter.get(k).push(g);
    });

    return screen("Tonight", `
      <p class="count">${guests.length} at the dinner</p>
      ${[...byInviter.entries()].map(([inviter, list]) => `
        <h3 class="sec">Guest${list.length === 1 ? "" : "s"} of ${esc(inviter)}</h3>
        ${list.map(g => `
          <div class="guest">
            <a class="guest-main" href="#/person/${encodeURIComponent(Model.contactKey(g))}">
              <strong>${esc(Model.fullName(g))}</strong>
              <small>${esc(c(g.firm))}</small>
              <small class="guest-inviter">Invited by ${esc(inviter)}</small>
              ${ownerLine(g, app)}
            </a>
            <a class="btn btn-small" href="#/capture/${encodeURIComponent(Model.contactKey(g))}">Log</a>
          </div>`).join("")}
      `).join("")}
    `);
  }

  /**
   * Who is taking this guest tonight, read from the Sheet's own Ownership column.
   * The split gets decided out loud ten minutes before dinner; what matters is
   * that it then sits next to the person on everyone's phone, not in a thread
   * someone has to scroll back through at nine o'clock.
   */
  function ownerLine(g, app) {
    // Read from the ownership column. (The previous build also looked for a
    // "Dinner owner" field, which Code.gs never returns.)
    const owner = c(g.ownership);
    if (!owner) return `<small class="guest-free">No owner</small>`;
    return Model.isMine({ ownership: owner, removed: "" }, app.me)
      ? `<small class="guest-mine">Yours tonight</small>`
      : `<small class="guest-owner">${esc(owner)}</small>`;
  }

  /* ---- day summary ------------------------------------------------------
     Not an in-app screen with notifications — a shareable recap, copyable in two
     gestures, posted manually to Slack each evening. */

  function summary(app) {
    const day = app.summaryDay || Model.localDay(app.now());
    const s = Model.daySummary(day, app.ctx);
    const text = Model.summaryToText(s);
    const days = Model.eventDays();
    return screen("Day summary", `
      <div class="daypick">
        ${days.map(d => `<button class="chip ${d === day ? "chip-active" : "chip-add"}" data-act="day" data-day="${d}">${esc(Model.formatDay(d).replace(/,.*$/, ""))}</button>`).join("")}
      </div>
      <pre class="recap">${esc(text)}</pre>
      <button class="btn btn-primary" data-act="copy">Copy for Slack</button>
      <p class="muted small pad">Paste it in the team channel. The debrief is a team object, not a personal one.</p>
    `);
  }

  /* ---- logged on site -----------------------------------------------------
     Everyone captured who matches nobody in the prepared file. On a walk-up day
     that is most of it, and in the first build it was write-only: saved to the
     Sheet and then invisible, so a rep could not check what they had written. */

  function onsite(app) {
    const people = Model.unmatchedPeople(app.ctx.encounters, app.ctx.contacts);
    if (!people.length) {
      return screen("Logged on site", `<div class="empty">
        <p>Nothing yet.</p>
        <p class="muted">People you log who are not in the prepared file show up here.</p></div>`);
    }
    return screen("Logged on site", `
      <p class="count">${people.length} ${people.length === 1 ? "person" : "people"} not in the file</p>
      ${people.map(p => `
        <div class="block block-thread">
          <h3 class="onsite-name">${esc(p.fullName)}${c(p.firm) ? ` · <span class="onsite-firm">${esc(c(p.firm))}</span>` : ""}</h3>
          ${p.encounters.map(encounterLine).join("")}
        </div>`).join("")}
      <p class="muted small pad">All of these are already in the Sheet. They appear here rather than on a
      card because no prepared row matches the name and firm that were typed.</p>
    `);
  }

  /* ---- settings ---------------------------------------------------------- */

  function settings(app) {
    const s = Sync.state;
    const warnings = (app.snapshot && app.snapshot.sheetHealth && app.snapshot.sheetHealth.warnings) || [];
    const moments = Model.previewMoments();
    return screen("Settings", `
      <section class="block">
        <h3>You</h3>
        ${field("Signed in as", app.me.email)}
        ${field("Name", app.me.fullName || app.me.name)}
        ${field("Logged as", app.me.name)}
        ${field("Role", app.me.role)}
        <label class="toggle"><input type="checkbox" data-act="toggle-tutor" ${app.me.isTutor ? "checked" : ""}/> Show the tutor observation field</label>
        <label class="toggle"><input type="checkbox" data-act="toggle-list" ${app.me.hasList ? "checked" : ""}/> I have an assigned list</label>
        <label class="setting">Name in the Sheet's ownership column
          <input type="text" data-act="ownername" value="${esc((app.me.ownerNames || []).join(", "))}" placeholder="e.g. Anna" />
        </label>
      </section>

      <section class="block">
        <h3>Sync</h3>
        ${field("Status", Sync.statusText())}
        ${field("Captures waiting", String(s.pending))}
        ${field("People in the local copy", String(app.ctx.contacts.length))}
        ${field("Directory entries", String((app.snapshot && app.snapshot.directory || []).length))}
        ${field("Encounters logged", String(app.ctx.encounters.length))}
        ${tabsUsed(app)}
        ${s.lastError ? field("Last problem", s.lastError) : ""}
        <button class="btn" data-act="resync">Resync now</button>
      </section>

      <section class="block ${s.authState === "stale" ? "block-warn" : ""}">
        <h3>Reconnect</h3>
        <p class="muted small">Your Google sign-in lasts about an hour. When it runs out the app keeps
        working and keeps saving, but it cannot reach the Sheet until you sign in again.
        ${s.pending ? `<strong>You have ${s.pending} capture${s.pending === 1 ? "" : "s"} waiting.</strong> They will go up on their own the moment this works — nothing needs re-typing.` : ""}</p>
        <div id="reauth"></div>
        <p class="muted small">This never deletes anything on this phone.</p>
      </section>

      <section class="block">
        <h3>Preview a phase</h3>
        <p class="muted small">The home screen reorders itself from one phase of the event to the next, and “Tonight” only exists during the dinner. Use this at onboarding so nobody reads it as a bug.</p>
        <div class="daypick">
          <button class="chip ${!app.dateOverride ? "chip-active" : "chip-add"}" data-act="preview" data-day="">Real date</button>
          ${moments.map(m => `<button class="chip ${app.dateOverride === m.at ? "chip-active" : "chip-add"}" data-act="preview" data-day="${esc(m.at)}">${esc(m.label)}</button>`).join("")}
        </div>
      </section>

      ${warnings.length ? `<section class="block block-warn">
        <h3>Sheet health</h3>
        <p class="muted small">Columns the app looked for and did not find. Each one renders blank rather than breaking anything — but the ones the capture form writes to are worth adding.</p>
        <ul>${warnings.map(w => `<li>${esc(w)}</li>`).join("")}</ul>
      </section>` : ""}

      <section class="block">
        <h3>About</h3>
        <p class="muted small">The Google Sheet is the database. Contact rows are never modified — every capture appends a new row to ${app.snapshot && app.snapshot.sheetHealth && app.snapshot.sheetHealth.tabs ? `<em>${esc(app.snapshot.sheetHealth.tabs.encounters)}</em>` : "the write tab"}. Nothing is written to HubSpot, ever.</p>
      </section>
    `);
  }

  /** Which tabs the backend actually read. Tab names change; this is how a wrong
   *  resolution becomes something a user can see and report, instead of silence. */
  function tabsUsed(app) {
    const tabs = app.snapshot && app.snapshot.sheetHealth && app.snapshot.sheetHealth.tabs;
    if (!tabs) return "";
    return field("Reading", [tabs.contacts, tabs.directory].filter(Boolean).join(" · ")) +
           field("Writing to", tabs.encounters);
  }

  /* ---- first run --------------------------------------------------------
     The ONLY screen that can block the app, and only before anyone has ever
     signed in on this device. That happens at the onboarding session before
     departure, where a network round-trip is acceptable. Once an identity is
     cached, this screen is unreachable — a dead token means offline, not login. */

  function signIn() {
    return `<main class="firstrun">
      <h1>${esc(EVENT.name)}</h1>
      <p>Sales field app. Sign in once with your <strong>@deepip.ai</strong> account — after that it works offline.</p>
      <div id="gbtn"></div>
      <p class="muted small">Do this before you fly.</p>
    </main>`;
  }

  return { esc, screen, renderStatus, home, list, person, firm, searchScreen, searchResults,
           capture, tonight, summary, settings, signIn, personRow, onsite };
})();
