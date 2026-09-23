/* Everything derived. No state, no DOM, no network — pure functions over the
 * snapshot, so the rules below can be reasoned about (and unit-tested) on their own.
 *
 * Two principles from the brief are enforced here rather than in the UI:
 *
 *   "Met" is a COMPUTED state — does an encounter exist — never a stored field.
 *   A contact row is never modified; every capture is a new encounter.
 *
 *   Empty means empty. A blank tiering or role cell is legitimately blank and
 *   renders as nothing at all: never 0, never "unknown", never "N/A".
 */

const Model = (() => {

  /* ---- value hygiene --------------------------------------------------- */

  const NULLISH = new Set(["", "-", "--", "n/a", "na", "none", "#n/a"]);

  /** Trims, and collapses the values that mean "nothing here" to "". */
  function clean(v) {
    if (v === null || v === undefined) return "";
    const s = String(v).trim();
    return NULLISH.has(s.toLowerCase()) ? "" : s;
  }

  const has = v => clean(v) !== "";

  /** Loose key for joining people across tabs and free-text captures. */
  const norm = s => clean(s).toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")   // é -> e
    .replace(/[^a-z0-9]+/g, " ").trim();

  const fullName = c => [clean(c.firstName), clean(c.lastName)].filter(Boolean).join(" ");

  /** Identity used to join encounters to contacts. Name + firm, not row number —
   *  rows shift when late registrations are added on the morning of day one. */
  const personKey = (name, firm) => norm(name) + "|" + norm(firm);
  const contactKey = c => personKey(fullName(c), c.firm);
  // Encounters carry split names, like contacts: Code.gs never sends a fullName.
  const encounterKey = e => personKey(fullName(e), e.firm);

  /** Human-readable pointer written into the "Contact ref" column of "3. On site". */
  const contactRef = c => `${fullName(c)} — ${clean(c.firm)}`;

  /**
   * A cell formatted as a real date in the Sheet arrives as an ISO string (the
   * backend converts Date objects on the way out). Render it the way the Sheet
   * reads — "7 Sept 2026" — rather than showing a raw timestamp on the card.
   * Anything that is not a date passes straight through, so "never" stays "never".
   */
  function displayDate(v) {
    const s = clean(v);
    if (!/^\d{4}-\d{2}-\d{2}(T|$)/.test(s)) return s;
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  }

  function parseMoney(v) {
    const s = clean(v).replace(/[^0-9.]/g, "");
    if (!s) return null;
    const n = Number(s);
    return isNaN(n) ? null : n;
  }

  /* ---- priority -------------------------------------------------------- */

  /**
   * The sales-set "Priority level 1-2-3" wins; "Suggested Prio" is the fallback.
   * Customer rows may carry a flag ("CUSTOMER - do not pitch…") where a number
   * would be — those have no priority and still render.
   */
  function priority(c) {
    const explicit = clean(c.priority).match(/[123]/);
    if (explicit) return { value: Number(explicit[0]), source: "sales" };
    const suggested = clean(c.suggestedPrio);
    const m = suggested.match(/^P\s*([123])/i);
    if (m) return { value: Number(m[1]), source: "suggested" };
    return { value: null, source: suggested ? "flag" : "none" };
  }

  const priorityLabel = c => {
    const p = priority(c);
    if (p.value === null) return "";
    return p.source === "suggested" ? `P${p.value} (suggested)` : `P${p.value}`;
  };

  /* ---- flags ----------------------------------------------------------- */

  function flags(c) {
    const suggested = clean(c.suggestedPrio).toLowerCase();
    const status = clean(c.accountStatus).toLowerCase();
    return {
      customer: status === "customer" || suggested.indexOf("customer") === 0,
      doNotPitch: suggested.indexOf("do not pitch") > -1 || suggested.indexOf("don't pitch") > -1,
      dinner: /^(yes|y|1|true)$/i.test(clean(c.dinner)) || clean(c.track).toLowerCase() === "dinner",
      advanced: /^a\b/i.test(clean(c.aiMaturity))
    };
  }

  /** Level 1 in the list is one line. One flag icon, highest precedence only. */
  function topFlag(c) {
    const f = flags(c);
    if (f.customer) return { key: "customer", icon: "●", label: "Customer" };
    if (f.doNotPitch) return { key: "nopitch", icon: "○", label: "Do not pitch" };
    if (f.dinner) return { key: "dinner", icon: "◆", label: "At the dinner" };
    if (f.advanced) return { key: "advanced", icon: "▲", label: "Advanced user" };
    return null;
  }

  /* ---- engagement ------------------------------------------------------ */

  /**
   * Collapsed on the card, and only for records on EVENT.engagementTrack: the
   * track whose attendees were given product accounts. Empty in config means no
   * engagement block at all. For attendees on that track with no account, "No
   * product account" is the answer — that is information, not a missing value.
   * Projects created is the better signal: creating a project is real work, chat
   * volume mixes curiosity with use.
   */
  function engagement(c) {
    const track = clean(EVENT.engagementTrack).toLowerCase();
    if (!track || clean(c.track).toLowerCase() !== track) return null;
    const level = clean(c.engagement);
    const signal = clean(c.signal);
    const noAccount = !level || /^no account$/i.test(level);
    return {
      noAccount,
      level: noAccount ? "" : level,
      signal: /^no account$/i.test(signal) ? "" : signal,
      projects: clean(c.projects),
      conversations: clean(c.conversations),
      lastCrm: displayDate(c.lastCrm)
    };
  }

  /* ---- met state ------------------------------------------------------- */

  /**
   * A person can legitimately be met several times by several people — in a
   * session, at the dinner, at the stand. The card shows the thread.
   */
  /**
   * Second-chance join for a capture typed by hand.
   *
   * The exact join is normalised name + firm, which fails on the way people
   * actually type under pressure: a first and last name with a lower-case
   * surname and a one-word firm, against a row carrying a middle name and the
   * firm's full legal name in capitals. So when the exact key
   * misses, try again: every word of the typed name must appear in the contact's
   * name, and one firm must be a prefix of the other.
   *
   * Two guards keep it honest. At least two words, so a lone surname cannot
   * sweep up a stranger. And a unique winner — faced with two plausible people
   * it attaches to neither, because a note filed under the wrong person is worse
   * than a note filed under nobody.
   */
  function looseContactMatch(enc, contacts) {
    const typedName = norm(fullName(enc));
    const typedFirm = norm(enc.firm);
    const words = typedName.split(" ").filter(Boolean);
    if (words.length < 2) return null;

    const hits = (contacts || []).filter(c => {
      const theirName = norm(fullName(c));
      if (!theirName) return false;
      const theirWords = new Set(theirName.split(" "));
      if (!words.every(w => theirWords.has(w))) return false;
      const theirFirm = norm(c.firm);
      if (!typedFirm || !theirFirm) return true; // nothing to contradict the name
      return theirFirm.indexOf(typedFirm) === 0 || typedFirm.indexOf(theirFirm) === 0;
    });
    return hits.length === 1 ? hits[0] : null;
  }

  function indexEncounters(encounters, contacts) {
    const byPerson = new Map();
    const known = new Set((contacts || []).map(contactKey));
    (encounters || []).forEach(e => {
      let k = e.contactRef ? personKey(...splitRef(e.contactRef)) : encounterKey(e);
      if (!known.has(k)) {
        const found = looseContactMatch(e, contacts);
        if (found) k = contactKey(found);
      }
      if (!byPerson.has(k)) byPerson.set(k, []);
      byPerson.get(k).push(e);
    });
    byPerson.forEach(list => list.sort((a, b) => String(b.capturedAt || b.date).localeCompare(String(a.capturedAt || a.date))));
    return byPerson;
  }

  function splitRef(ref) {
    const parts = String(ref).split("—");
    return [ (parts[0] || "").trim(), (parts[1] || "").trim() ];
  }

  const threadFor = (c, index) => index.get(contactKey(c)) || [];

  /** Met = at least one encounter that isn't an explicit "No" / "Not seen". */
  const isMet = (c, index) =>
    threadFor(c, index).some(e => !/^(no|not seen)$/i.test(clean(e.met)));

  /**
   * Captures that match nobody in the file, grouped by person, newest first.
   * These are the walk-up encounters the app is built for — and in the first
   * build they were invisible once saved: in the Sheet and nowhere on screen.
   */
  function unmatchedPeople(encounters, contacts) {
    const known = new Set((contacts || []).map(contactKey));
    const groups = new Map();
    (encounters || []).forEach(e => {
      let k = e.contactRef ? personKey(...splitRef(e.contactRef)) : encounterKey(e);
      if (known.has(k)) return;
      if (looseContactMatch(e, contacts)) return;
      if (!groups.has(k)) {
        groups.set(k, { key: k, fullName: fullName(e), firm: clean(e.firm), encounters: [] });
      }
      groups.get(k).encounters.push(e);
    });
    const list = [...groups.values()];
    list.forEach(g => g.encounters.sort((a, b) =>
      String(b.capturedAt || b.date).localeCompare(String(a.capturedAt || a.date))));
    return list.sort((a, b) =>
      String(b.encounters[0].capturedAt || "").localeCompare(String(a.encounters[0].capturedAt || "")));
  }

  /* ---- firms ----------------------------------------------------------- */

  /** Derived in-app, never stored. This is what makes "that firm sent four,
   *  three met" visible. */
  function buildFirms(contacts) {
    const firms = new Map();
    contacts.forEach(c => {
      const k = norm(c.firm);
      if (!k) return;
      if (!firms.has(k)) firms.set(k, { key: k, name: clean(c.firm), members: [] });
      firms.get(k).members.push(c);
    });
    return firms;
  }

  const firmMates = (c, firms) => {
    const g = firms.get(norm(c.firm));
    if (!g) return [];
    return g.members.filter(m => contactKey(m) !== contactKey(c));
  };

  /* ---- what to say -----------------------------------------------------
     Block 4 of the card, and the one that actually gets read. The prepared
     field note wins; the sales rep's own objective is the fallback; a written
     opening is the last resort so a Dinner or On-site record degrades into
     something usable instead of an empty box. */

  function whatToSay(c) {
    const note = clean(c.fieldNotes);
    if (note) return { label: "What to say", text: note, prepared: true };
    const angle = clean(c.angle);
    if (angle) return { label: "Your objective", text: angle, prepared: true };
    return { label: "What to say", text: fallbackOpening(c), prepared: false };
  }

  function fallbackOpening(c) {
    const f = flags(c);
    if (inviterOf(c)) return `No prepared note. Guest of ${inviterOf(c)} — open on that.`;
    if (f.customer) return "No prepared note. Existing customer — listen, do not pitch.";
    if (clean(c.aiMaturity)) return `No prepared note. Self-declared ${clean(c.aiMaturity)} on AI — start there.`;
    if (clean(c.firm)) return `No prepared note. Open on ${clean(c.firm)} and what drafting looks like for them.`;
    return "No prepared note.";
  }

  /* ---- competitors ----------------------------------------------------- */

  /** From what was captured on site first, and from the prepared field notes second. */
  function competitorFor(c, index) {
    const fromEncounters = threadFor(c, index)
      .map(e => clean(e.toolToday))
      .find(t => COMPETITORS.some(x => t.toLowerCase() === x.toLowerCase()));
    if (fromEncounters) return fromEncounters;
    const text = (clean(c.fieldNotes) + " " + clean(c.angle)).toLowerCase();
    return COMPETITORS.find(x => text.indexOf(x.toLowerCase()) > -1) || "";
  }

  /* ---- filters --------------------------------------------------------- */
  /*
    One list, one set of filters, same for everyone. Each filter is a chip the
    user can remove — including the default one, which is why the default is a
    real entry in the active set and never an implicit condition baked into the
    query. Tap the cross and you see all 100.
  */

  function availableFilters(ctx) {
    const base = [
      { id: "mine",       label: "Assigned to me",        test: c => isMine(c, ctx.me) },
      // Blank ownership is its own group: anyone on the floor can pick it up.
      // Derived at read time; the app never writes to the ownership column.
      { id: "noowner",    label: "No owner",              test: c => !has(c.ownership) },
      { id: "p1",         label: "Priority 1",            test: c => priority(c).value === 1 },
      { id: "p2",         label: "Priority 2",            test: c => priority(c).value === 2 },
      { id: "p3",         label: "Priority 3",            test: c => priority(c).value === 3 },
      { id: "notmet",     label: "Not yet met",           test: c => !isMet(c, ctx.index) },
      { id: "customers",  label: "Customers",             test: c => flags(c).customer },
      { id: "advanced",   label: "A — Advanced",          test: c => flags(c).advanced },
      { id: "engaged",    label: "Product engagement",    test: c => { const e = engagement(c); return !!e && !e.noAccount; } },
      { id: "competitor", label: "Using a competitor",    test: c => !!competitorFor(c, ctx.index) },
      { id: "dinner",     label: "At the dinner",         test: c => flags(c).dinner },
      { id: "multifirm",  label: "Firms with several here", test: c => (ctx.firms.get(norm(c.firm))?.members.length || 0) > 1 }
    ];
    return base;
  }

  /** "assigned to me" also honours the sales rep's own "Remove from my list" tick. */
  function isMine(c, me) {
    if (!me || !me.ownerNames || !me.ownerNames.length) return false;
    if (/^(yes|y|1|true|x)$/i.test(clean(c.removed))) return false;
    const owner = norm(c.ownership);
    if (!owner) return false;
    return me.ownerNames.some(n => owner.indexOf(norm(n)) > -1);
  }

  function applyFilters(contacts, activeIds, ctx) {
    if (!activeIds.length) return contacts.slice();
    const all = availableFilters(ctx);
    const active = activeIds.map(id => all.find(f => f.id === id)).filter(Boolean);
    // Priority chips are alternatives to each other; everything else narrows.
    const prio = active.filter(f => /^p[123]$/.test(f.id));
    const rest = active.filter(f => !/^p[123]$/.test(f.id));
    return contacts.filter(c =>
      (!prio.length || prio.some(f => f.test(c))) && rest.every(f => f.test(c))
    );
  }

  function sortContacts(list, ctx, { notMetFirst = false } = {}) {
    return list.slice().sort((a, b) => {
      if (notMetFirst) {
        const am = isMet(a, ctx.index) ? 1 : 0;
        const bm = isMet(b, ctx.index) ? 1 : 0;
        if (am !== bm) return am - bm;
      }
      const ap = priority(a).value, bp = priority(b).value;
      if (ap !== bp) {
        if (ap === null) return 1;
        if (bp === null) return -1;
        return ap - bp;
      }
      return clean(a.lastName).localeCompare(clean(b.lastName));
    });
  }

  /* ---- search ---------------------------------------------------------- */

  /** What the second list is called at this event. "directory" by default. */
  const directoryLabel = () => clean(EVENT.directoryLabel) || "directory";

  function search(term, ctx) {
    const q = norm(term);
    if (q.length < 2) return { contacts: [], directory: [] };
    const hit = (...fields) => norm(fields.join(" ")).indexOf(q) > -1;
    return {
      contacts: ctx.contacts.filter(c => hit(fullName(c), c.firm, c.email, c.country)).slice(0, 40),
      directory: (ctx.directory || []).filter(d => hit(d.fullName, d.firm, d.country, d.city, d.email)).slice(0, 40)
    };
  }

  /* ---- the dinner ------------------------------------------------------ */

  /**
   * Show the inviter from the "Invited by" column, never from the HubSpot owner —
   * they match in only 3 of 11 cases, and one of the four inviters does not appear
   * as a HubSpot owner anywhere in the file.
   */
  function dinnerGuests(ctx) {
    return ctx.contacts
      .filter(c => flags(c).dinner)
      .sort((a, b) => (clean(a.invitedBy) || "zzz").localeCompare(clean(b.invitedBy) || "zzz")
                   || clean(a.lastName).localeCompare(clean(b.lastName)));
  }

  const inviterOf = c => clean(c.invitedBy);

  /* ---- day summary ----------------------------------------------------- */

  /**
   * A team object, not a personal one — hence a shareable block of text rather
   * than an in-app notification. A day with a list phase (home: "list") is a day
   * with a denominator ("twelve on your list, seven met"); on a capture day it
   * becomes a completeness check.
   *
   * The day of a capture is its day in the EVENT's timezone. `capturedAt` is a UTC
   * ISO string, so slicing it would move every evening capture on a Toronto event
   * to the next day's recap.
   */
  function daySummary(dateISO, ctx) {
    const day = dateISO.slice(0, 10);
    const todays = (ctx.encounters || []).filter(e => dayOf(e.capturedAt || e.date) === day);

    const byPerson = new Map();
    todays.forEach(e => {
      const who = clean(e.metBy) || "Unattributed";
      if (!byPerson.has(who)) byPerson.set(who, []);
      byPerson.get(who).push(e);
    });

    const hasDenominator = phasesStartingOn(day).some(p => p.home === "list");
    const people = [...byPerson.entries()].map(([who, list]) => {
      const row = {
        who,
        captures: list.length,
        emptyHooks: list.filter(e => !has(e.hook)).length,
        missingNextSteps: list.filter(e => !has(e.nextStep)).length,
        unknowns: list.filter(e => !/^yes$/i.test(clean(e.inList))).length,
        listSize: null,
        listMet: null
      };
      if (hasDenominator) {
        const profile = findUserByName(who);
        if (profile && profile.hasList) {
          const mine = ctx.contacts.filter(c => isMine(c, profile));
          row.listSize = mine.length;
          row.listMet = mine.filter(c => isMet(c, ctx.index)).length;
        }
      }
      return row;
    }).sort((a, b) => b.captures - a.captures);

    return { day, total: todays.length, hasDenominator, people };
  }

  /**
   * Resolves a "Met by" value back to a user profile, to get the denominator on
   * a list day. The column is typed by hand and by whichever version of the app
   * wrote it, so "Anna", "Anna Smith" and "anna.smith@deepip.ai" all have to
   * land on the same person. Exact matches win before loose ones, so a
   * short first name can never steal a row from a fuller match.
   */
  function findUserByName(name) {
    const n = norm(name);
    if (!n) return null;
    const users = Object.entries(USERS).map(([email, u]) => Object.assign({ email }, u));

    const exact = users.find(u =>
      norm(u.name) === n || norm(u.fullName) === n || norm(u.email) === n);
    if (exact) return exact;

    return users.find(u =>
      n.indexOf(norm(u.fullName || "")) > -1 ||
      (u.ownerNames || []).some(o => norm(o) && n.indexOf(norm(o)) > -1)) || null;
  }

  /** Plain text, ready to paste into Slack. Copyable in two gestures. */
  function summaryToText(summary) {
    const label = phasesStartingOn(summary.day).map(p => p.label).join(" + ");
    const lines = [
      `*${EVENT.name} — ${formatDay(summary.day)}*${label ? ` (${label})` : ""}`,
      `${summary.total} capture${summary.total === 1 ? "" : "s"} logged.`,
      ""
    ];
    if (!summary.people.length) lines.push("_Nothing logged yet._");
    summary.people.forEach(p => {
      const bits = [`${p.captures} capture${p.captures === 1 ? "" : "s"}`];
      if (p.listSize !== null) bits.push(`${p.listMet}/${p.listSize} of your list met`);
      if (p.unknowns) bits.push(`${p.unknowns} not in the file`);
      lines.push(`• *${p.who}* — ${bits.join(", ")}`);
      const gaps = [];
      if (p.emptyHooks) gaps.push(`${p.emptyHooks} without a hook`);
      if (p.missingNextSteps) gaps.push(`${p.missingNextSteps} without a next step`);
      if (gaps.length) lines.push(`   ↳ to finish tonight: ${gaps.join(", ")}`);
    });
    return lines.join("\n");
  }

  /** en-GB, not the device locale: the recap is a shared object pasted into a
   *  channel read by the whole team, not a personal screen. */
  function formatDay(day) {
    const d = new Date(day + "T12:00:00");
    return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  }

  /* ---- the calendar ---------------------------------------------------- */
  /*
    Date-driven, not a setting. The event is described as EVENT.phases in
    config.js and everything here reads the clock against them: which home
    screen, whether "Tonight" exists, what goes in the "Session / moment" column,
    which days the recap offers.

    `now` is injectable so the team can rehearse a later phase at the onboarding
    session without anyone reading the flip as a bug (Settings > Preview a phase).

    Phase times are local to the EVENT (EVENT.timezone), not to the phone. They
    are converted explicitly, so a phone still set to the builder's timezone at
    onboarding sees the same phases as a phone on site.
  */

  const PHASES = () => (typeof EVENT !== "undefined" && EVENT.phases) || [];

  /** Offset of `tz` from UTC at instant `date`, in ms. */
  function tzOffsetMs(date, tz) {
    const f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit"
    });
    const p = {};
    f.formatToParts(date).forEach(x => { p[x.type] = x.value; });
    const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
    return asUtc - Math.floor(date.getTime() / 1000) * 1000;
  }

  /** "2026-09-28T18:00" read as event-local time -> Date. */
  function eventTime(iso) {
    const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
    if (!m) return new Date(NaN);
    const [y, mo, d, h, mi] = [+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)];
    const tz = EVENT.timezone;
    if (!tz) return new Date(y, mo, d, h, mi);   // no timezone configured: the phone's
    const guess = Date.UTC(y, mo, d, h, mi);
    let t = guess - tzOffsetMs(new Date(guess), tz);
    t = guess - tzOffsetMs(new Date(t), tz);     // second pass settles a DST edge
    return new Date(t);
  }

  /** Event-local wall clock of an instant, as "YYYY-MM-DDTHH:MM". */
  function eventLocalIso(date) {
    const tz = EVENT.timezone;
    const d = tz ? new Date(date.getTime() + tzOffsetMs(date, tz)) : null;
    const pad = n => String(n).padStart(2, "0");
    return tz
      ? `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
      : `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  /** Event-local day of a Date. */
  const localDay = d => eventLocalIso(d).slice(0, 10);

  /** Event-local day of a stored value (UTC ISO from the Sheet or the queue). */
  function dayOf(v) {
    const d = new Date(v);
    return isNaN(d.getTime()) ? String(v || "").slice(0, 10) : localDay(d);
  }

  /** Event-local "YYYY-MM-DD HH:MM" of a stored value, for display on a thread. */
  function whenOf(v) {
    const d = new Date(v);
    return isNaN(d.getTime()) ? String(v || "").slice(0, 16).replace("T", " ") : eventLocalIso(d).replace("T", " ");
  }

  /**
   * The phase `now` falls in, or null. Windows may overlap; the FIRST declared
   * match wins, which is why a dinner is declared before its day. `to` includes
   * its own minute, so "23:59" covers the last minute of the day.
   */
  function phaseFor(now) {
    const t = now.getTime();
    return PHASES().find(p =>
      t >= eventTime(p.from).getTime() && t < eventTime(p.to).getTime() + 60000) || null;
  }

  /**
   * The phase that sets the home screen. Inside a window, that window. Between or
   * after windows, the last one that ended, so the home screen does not flip back
   * overnight. Before the event, the first one.
   */
  function phaseAt(now) {
    const hit = phaseFor(now);
    if (hit) return hit;
    const t = now.getTime();
    const ended = PHASES().filter(p => eventTime(p.to).getTime() <= t)
      .sort((a, b) => eventTime(b.to) - eventTime(a.to));
    return ended[0] || PHASES()[0] || null;
  }

  /** "Tonight" exists only inside a phase flagged tonight, never by fallback. */
  const showTonight = now => { const p = phaseFor(now); return !!(p && p.tonight); };

  const homeFlipped = now => { const p = phaseAt(now); return !!(p && p.home === "capture"); };

  /** What to stamp into the "Session / moment" column: the phase id. */
  function sessionId(now) {
    const p = phaseFor(now);
    return p ? p.id : "off-programme";
  }

  /** What the user reads for the current moment. */
  function phaseLabel(now) {
    const p = phaseFor(now);
    return p ? p.label : "Off-programme";
  }

  /** A stored session id shown as its label; older free-text values pass through. */
  function sessionDisplay(id) {
    const p = PHASES().find(x => x.id === clean(id));
    return p ? p.label : clean(id);
  }

  const phasesStartingOn = day =>
    PHASES().filter(p => String(p.from).slice(0, 10) === day)
      .sort((a, b) => String(a.from).localeCompare(String(b.from)));

  /** The days the recap offers: every day a phase starts on, in order. */
  const eventDays = () =>
    [...new Set(PHASES().map(p => String(p.from).slice(0, 10)))].sort();

  /**
   * One preview moment per phase, for Settings: the first half-hour inside the
   * window where that phase actually wins (a narrow phase declared first can
   * shadow the start of a wide one). Returned as event-local ISO.
   */
  function previewMoments() {
    return PHASES().map(p => {
      const end = eventTime(p.to).getTime();
      for (let t = eventTime(p.from).getTime(); t <= end; t += 30 * 60000) {
        const hit = phaseFor(new Date(t));
        if (hit && hit.id === p.id) return { id: p.id, label: p.label, at: eventLocalIso(new Date(t)) };
      }
      return null;
    }).filter(Boolean);
  }

  return {
    clean, has, norm, fullName, contactKey, encounterKey, contactRef, personKey, parseMoney, displayDate,
    priority, priorityLabel, flags, topFlag, engagement, whatToSay,
    indexEncounters, threadFor, isMet, looseContactMatch, unmatchedPeople,
    buildFirms, firmMates, competitorFor, directoryLabel,
    availableFilters, applyFilters, sortContacts, isMine, search,
    dinnerGuests, inviterOf,
    daySummary, summaryToText, formatDay,
    eventTime, eventLocalIso, phaseFor, phaseAt, showTonight, homeFlipped,
    sessionId, phaseLabel, sessionDisplay, eventDays, previewMoments, localDay, dayOf, whenOf
  };
})();
