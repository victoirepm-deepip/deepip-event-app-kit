/* The sync engine. Owns every network call the app makes.
 *
 * Failure policy, in one place, because it is the thing that decides whether this
 * build survives a bad morning:
 *
 *   - A capture is written to IndexedDB before a request is attempted.
 *   - Any failure — offline, timeout, 401, expired token, HTML error page from
 *     Google — results in the same thing: status goes to "offline", the queue is
 *     kept, the snapshot is kept, the app stays completely usable.
 *   - Nothing in this file clears local state. Nothing in this file navigates.
 *     There is no sign-in redirect path after first sign-in, by construction.
 */

const Sync = (() => {
  const state = {
    status: "idle",       // idle | syncing | online | offline
    authState: "never",   // never | ok | stale   (stale = token dead, data intact)
    lastSyncAt: null,     // last successful round-trip
    snapshotAt: null,     // when the local copy of the Sheet was taken
    pending: 0,
    lastError: null,
    frozen: false         // writes closed after the event
  };

  const listeners = new Set();
  const onChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
  function emit() {
    listeners.forEach(fn => { try { fn(state); } catch (e) { /* a bad listener must not stop sync */ } });
    document.dispatchEvent(new CustomEvent("sync:changed", { detail: state }));
  }

  /* ---- transport ------------------------------------------------------ */

  /**
   * POST to the Apps Script Web App.
   * Deliberately sends no custom Content-Type: that keeps the request "simple",
   * so the browser skips the CORS preflight, which Apps Script cannot answer.
   */
  async function post(payload) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SYNC.requestTimeoutMs);
    try {
      const res = await fetch(APPS_SCRIPT_URL, {
        method: "POST",
        body: JSON.stringify(payload),
        signal: controller.signal,
        redirect: "follow"
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch (err) {
        // Google served an HTML error/consent page instead of our JSON.
        // Same class of problem as being offline; treat it as such.
        throw new Error("Unexpected response from the server");
      }
    } finally {
      clearTimeout(timer);
    }
  }

  /** Everything network-facing funnels through here so the failure policy is single-sourced. */
  async function attempt(buildPayload) {
    const token = await Auth.getToken();
    if (!token) return goOffline("no valid token", Auth.hasIdentity() ? "stale" : "never");

    let res;
    try {
      res = await post(Object.assign({ token }, buildPayload()));
    } catch (err) {
      return goOffline(err.message);
    }

    if (res && res.auth === false) {
      // The server rejected the token. This is NOT a reason to sign the user out,
      // clear the queue, or show a login screen — it is a reason to work offline.
      // One silent refresh attempt, then we stay offline until the next tick.
      await Auth.refresh(6000);
      return goOffline("token rejected", "stale");
    }
    if (!res || res.ok === false) {
      return goOffline((res && res.error) || "unknown server error");
    }
    return res;
  }

  function goOffline(reason, authState) {
    state.status = "offline";
    state.lastError = reason || null;
    if (authState) state.authState = authState;
    Store.logEvent("offline", reason || "offline");
    emit();
    return null;
  }

  /* ---- public operations ---------------------------------------------- */

  /** Loads whatever is on the device. Runs before any network call, always. */
  async function hydrate() {
    const snap = await Store.loadSnapshot();
    state.pending = await Store.queueCount();
    if (snap) state.snapshotAt = snap.fetchedAt;
    if (Auth.hasIdentity()) state.authState = "stale"; // upgraded to "ok" on first success
    state.frozen = new Date() >= new Date(EVENT.freezeWritesFrom);
    emit();
    return snap;
  }

  /**
   * The only write path. Durable first, network second.
   * Returns as soon as the capture is safely on disk; the flush runs behind it.
   */
  async function capture(encounter) {
    await Store.enqueue(encounter);
    state.pending = await Store.queueCount();
    emit();
    flush();               // deliberately not awaited — the user moves on immediately
    return encounter;
  }

  let inFlight = null;    // the running flush, if any
  let runAgain = false;   // something arrived while it was running

  /**
   * Sends the queue and refreshes the snapshot in a single round-trip.
   * Safe to call as often as you like.
   *
   * Overlapping calls COALESCE rather than being dropped: a capture saved while
   * a sync is already in flight, or a user tapping Resync at that moment, queues
   * one more run instead of being silently ignored. Tapping Resync and having
   * nothing happen is exactly the kind of thing that makes people stop trusting
   * the pending counter.
   */
  function flush({ force = false } = {}) {
    if (state.frozen && !force) return Promise.resolve();
    if (inFlight) { runAgain = true; return inFlight; }

    inFlight = doFlush().finally(() => {
      inFlight = null;
      if (runAgain) { runAgain = false; return flush({ force }); }
    });
    return inFlight;
  }

  async function doFlush() {
    state.status = "syncing";
    emit();

    try {
      const pending = await Store.queued();
      const res = await attempt(() => ({
        action: "sync",
        encounters: pending,
        includeData: true
      }));
      if (!res) return; // goOffline already recorded it

      // Remove only what the server confirmed. `skipped` are rows it already had
      // (a retry after a timeout) — equally safe to drop from the queue.
      const done = [].concat(res.written || [], res.skipped || []).filter(Boolean);
      if (done.length) await Store.acknowledge(done);

      if (res.failed && res.failed.length) {
        Store.logEvent("error", res.failed.length + " capture(s) refused by the Sheet");
      }

      if (res.contacts) {
        await Store.saveSnapshot(res);
        state.snapshotAt = Date.now();
      }

      state.pending = await Store.queueCount();
      state.status = "online";
      state.authState = "ok";
      state.lastSyncAt = Date.now();
      state.lastError = null;
      Store.logEvent("ok", `synced — ${done.length} sent, ${state.pending} still queued`);
      emit();
      document.dispatchEvent(new CustomEvent("data:changed"));
    } finally {
      // A run that neither succeeded nor reported a failure must not leave the
      // status line stuck on "Syncing…".
      if (state.status === "syncing") { state.status = "offline"; emit(); }
    }
  }

  /* ---- scheduling ------------------------------------------------------ */

  function start() {
    setInterval(() => { if (document.visibilityState === "visible") flush(); }, SYNC.autoIntervalMs);
    window.addEventListener("online", () => flush());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") flush();
    });
    // A last chance to persist; the queue is already on disk so this is belt-and-braces.
    window.addEventListener("pagehide", () => { if (navigator.onLine) flush(); });
  }

  /* ---- status line ----------------------------------------------------- */

  /**
   * Seven people write to this Sheet during the event and the source data keeps
   * changing, so a user reading a card has to know how fresh it is. This string
   * is on screen at all times.
   */
  function statusText(now = Date.now()) {
    if (state.status === "syncing") return "Syncing…";
    if (state.status === "online" && state.lastSyncAt) {
      const mins = Math.floor((now - state.lastSyncAt) / 60000);
      if (mins < 1) return "Synced just now";
      if (mins < 60) return `Synced ${mins} min ago`;
      return `Synced ${fmtDayTime(state.lastSyncAt)}`;
    }
    if (state.snapshotAt) return `Offline — data from ${fmtDayTime(state.snapshotAt)}`;
    return "Offline — no data yet";
  }

  function isStale(now = Date.now()) {
    return !state.snapshotAt || (now - state.snapshotAt) > SYNC.snapshotStaleAfterMs;
  }

  function fmtDayTime(ts) {
    const d = new Date(ts);
    const day = d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
    const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    return `${day}, ${time}`;
  }

  return { state, onChange, hydrate, capture, flush, start, statusText, isStale, emit };
})();
