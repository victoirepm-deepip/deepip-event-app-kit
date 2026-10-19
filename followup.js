/* Follow-up page. One draft email per contact met, grouped by signer.
 *
 * Run it after the event, locally (http://localhost:4173/followup.html), never
 * from the public deploy repo: it renders every capture of the event. It reads
 * the same POST `data` snapshot as the field app and writes nothing anywhere:
 * no Sheet write, no CRM write, nothing stored, nothing generated to disk. The
 * drafts live in this tab until it is closed, and every one is reviewed and sent
 * by hand.
 *
 * Inputs (the follow-up contract, CLAUDE.md section 2): the five core capture
 * fields, `Session / moment` for the opening line, `Technical field` for the
 * signer, `Email` for people met outside the list. FOLLOW_UP in config.js holds
 * the copy and the signer table.
 */

const FollowUp = (() => {
  const M = Model;
  const clean = M.clean;
  const SKIP_MET = /^(no|not seen)$/i;
  const SKIP_TEMP = /^not a fit$/i;
  const REMOVED = /^(yes|y|1|true|x)$/i;

  const NEXT_STEP_LINES = {
    "demo": "As discussed, I would be glad to show you DeepIP in a short demo with your team. Would a slot in the next two weeks suit you?",
    "intro": "As promised, I will make the introduction we talked about in a separate email.",
    "send content": "As promised, here is the material we talked about.",
    "nothing": ""
  };

  /** Join key from the brief: email trimmed and lowercased, else first + last + firm. */
  const emailKey = v => clean(v).toLowerCase();

  function build(snapshot, cfg = FOLLOW_UP) {
    const contacts = (snapshot.contacts || []);
    const byEmail = new Map(), byName = new Map();
    contacts.forEach(c => {
      if (emailKey(c.email)) byEmail.set(emailKey(c.email), c);
      byName.set(M.contactKey(c), c);
    });

    // One person, however many times they were met, by however many people.
    const people = new Map();
    (snapshot.encounters || []).forEach(e => {
      const contact = (emailKey(e.email) && byEmail.get(emailKey(e.email))) ||
                      byName.get(M.encounterKey(e)) || null;
      const k = contact ? "c:" + M.contactKey(contact) : "e:" + (emailKey(e.email) || M.encounterKey(e));
      if (!people.has(k)) people.set(k, { contact, encounters: [] });
      people.get(k).encounters.push(e);
    });

    const drafts = [], skipped = [];
    people.forEach(p => {
      const encs = p.encounters.slice().sort((a, b) => String(a.capturedAt || a.date).localeCompare(String(b.capturedAt || b.date)));
      const first = encs[0], last = encs[encs.length - 1];
      const latest = key => { for (let i = encs.length - 1; i >= 0; i--) if (M.has(encs[i][key])) return clean(encs[i][key]); return ""; };
      const c = p.contact || {};
      const name = M.fullName(p.contact || last);
      const firm = clean(c.firm) || clean(last.firm);

      if (p.contact && REMOVED.test(clean(c.removed))) { skipped.push({ name, firm, why: "Marked Remove in the Field guide" }); return; }
      const met = latest("met"), temperature = latest("temperature");
      if (encs.every(e => SKIP_MET.test(clean(e.met)))) { skipped.push({ name, firm, why: "Never met (" + met + ")" }); return; }
      if (SKIP_TEMP.test(temperature)) { skipped.push({ name, firm, why: "Not a fit" }); return; }

      const to = clean(c.email) || latest("email");
      const metBy = [...new Set(encs.map(e => clean(e.metBy)).filter(Boolean))];
      const technicalField = latest("technicalField");
      const fieldSigner = technicalField && cfg.signers ? clean(cfg.signers[technicalField]) : "";
      const signer = fieldSigner || clean(last.metBy) || "Unassigned";
      const owner = clean(c[cfg.cc || "crmOwner"]);
      const cc = [owner, ...metBy].filter((v, i, a) => v && v !== signer && a.indexOf(v) === i);

      const opening = (cfg.moments || {})[clean(first.session)] ||
        `Thank you for the conversation at the ${EVENT.name}.`;
      const nextStep = latest("nextStep");
      const nextLine = NEXT_STEP_LINES[nextStep.toLowerCase()] ?? "";
      const hello = clean(c.firstName || last.firstName) ? `Dear ${clean(c.firstName || last.firstName)},` : `Dear ${name},`;
      const body = [hello, "", opening, nextLine ? "\n" + nextLine : "", "", "Best regards,", signer]
        .filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n");

      drafts.push({
        name, firm, to, cc, signer,
        signerSource: fieldSigner ? "technical field" : "met by",
        subject: `${EVENT.name}: following up`,
        body,
        // What the reviewer weaves in by hand. Hooks are field notes, not prose,
        // so they are shown next to the draft and never pasted into it.
        notes: encs.map(e => ({
          by: clean(e.metBy), when: M.sessionDisplay(e.session),
          temperature: clean(e.temperature), toolToday: clean(e.toolToday),
          nextStep: clean(e.nextStep), hook: clean(e.hook), practitioners: clean(e.practitioners)
        })),
        temperature, technicalField,
        warnings: [
          to ? "" : "No email: not in the list and none typed on site.",
          technicalField ? (fieldSigner ? "" : `No signer set for "${technicalField}": Met by signs.`) : "No technical field: Met by signs."
        ].filter(Boolean)
      });
    });

    const rank = { hot: 0, warm: 1, cold: 2 };
    drafts.sort((a, b) => a.signer.localeCompare(b.signer) ||
      (rank[a.temperature.toLowerCase()] ?? 3) - (rank[b.temperature.toLowerCase()] ?? 3) ||
      a.name.localeCompare(b.name));
    return { drafts, skipped };
  }

  return { build };
})();

/* ---- Page ---------------------------------------------------------------- */

(function page() {
  if (typeof document === "undefined") return;
  const root = document.getElementById("fu");
  const esc = s => String(s ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

  function render({ drafts, skipped }) {
    const bySigner = new Map();
    drafts.forEach(d => { if (!bySigner.has(d.signer)) bySigner.set(d.signer, []); bySigner.get(d.signer).push(d); });
    root.innerHTML = `
      <p class="muted">${drafts.length} drafts, ${skipped.length} skipped. Nothing on this page is saved: close the tab and it is gone.</p>
      ${[...bySigner].map(([signer, list]) => `
        <h2 class="sec">${esc(signer)} (${list.length})</h2>
        ${list.map((d, i) => `
          <article class="card fu-card">
            <h3>${esc(d.name)} <span class="muted">· ${esc(d.firm)}</span> ${d.temperature ? `<span class="tag">${esc(d.temperature)}</span>` : ""}</h3>
            ${d.warnings.map(w => `<p class="fu-warn">${esc(w)}</p>`).join("")}
            <p><b>To:</b> ${esc(d.to || "—")}<br><b>Cc:</b> ${esc(d.cc.join(", ") || "—")}<br><b>Subject:</b> ${esc(d.subject)}</p>
            <textarea class="fu-body" rows="9">${esc(d.body)}</textarea>
            <button class="btn btn-small" data-copy>Copy draft</button>
            <details><summary>Field notes (${d.notes.length})</summary>
              <ul>${d.notes.map(n => `<li><b>${esc(n.by)}</b>, ${esc(n.when)}: ${esc([n.temperature, n.toolToday && "tool: " + n.toolToday, n.nextStep && "next: " + n.nextStep, n.practitioners && n.practitioners + " practitioners"].filter(Boolean).join(" · "))}${n.hook ? `<br><i>${esc(n.hook)}</i>` : ""}</li>`).join("")}</ul>
            </details>
          </article>`).join("")}`).join("")}
      ${skipped.length ? `<h2 class="sec">Skipped (${skipped.length})</h2><ul>${skipped.map(s => `<li>${esc(s.name)} · ${esc(s.firm)}: ${esc(s.why)}</li>`).join("")}</ul>` : ""}`;
  }

  root.addEventListener("click", e => {
    if (!e.target.matches("[data-copy]")) return;
    const card = e.target.closest(".fu-card");
    const head = [...card.querySelectorAll("p")].find(p => p.textContent.startsWith("To:"));
    navigator.clipboard.writeText((head ? head.innerText + "\n\n" : "") + card.querySelector("textarea").value);
    e.target.textContent = "Copied";
  });

  async function load() {
    root.innerHTML = `<p class="muted">Reading the Sheet…</p>`;
    try {
      const token = await Auth.getToken();
      if (!token) { root.innerHTML = `<p class="muted">Sign in with your @deepip.ai account to read the captures.</p>`; return; }
      const res = await fetch(APPS_SCRIPT_URL, { method: "POST", body: JSON.stringify({ action: "data", token }), redirect: "follow" });
      const snap = JSON.parse(await res.text());
      if (!snap.ok) throw new Error(snap.error || "refused");
      render(FollowUp.build(snap));
    } catch (err) {
      root.innerHTML = `<p class="fu-warn">Could not read the Sheet: ${esc(err.message || err)}</p>`;
    }
  }

  Auth.boot().then(() => {
    document.getElementById("fu-signin") && Auth.renderSignInButton(document.getElementById("fu-signin"));
    document.addEventListener("auth:changed", load, { once: true });
    if (Auth.hasIdentity()) load();
  });
})();
