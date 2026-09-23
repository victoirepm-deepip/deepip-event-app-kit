/* Local persistence. IndexedDB only — nothing here ever depends on the network.
 *
 * Three object stores:
 *   kv     — the snapshot, the cached identity, settings. Single keyed blobs.
 *   queue  — captures waiting to reach the Sheet. Append-only until acknowledged.
 *   log    — a short ring buffer of sync events, shown in Settings. Diagnostics only.
 *
 * The single rule this file exists to enforce: a capture is durable the moment
 * the user taps Save, before any request is attempted, and nothing short of an
 * explicit acknowledgement from the server removes it.
 */

const Store = (() => {
  // Per event: two events served from the same origin must not share a database.
  const DB_NAME = "deepip-field-" + ((typeof EVENT !== "undefined" && EVENT.slug) || "event");
  const DB_VERSION = 1;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
        if (!db.objectStoreNames.contains("queue")) db.createObjectStore("queue", { keyPath: "clientId" });
        if (!db.objectStoreNames.contains("log")) db.createObjectStore("log", { autoIncrement: true });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function tx(storeName, mode, fn) {
    return open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(storeName, mode);
      const store = t.objectStore(storeName);
      let result;
      try { result = fn(store); } catch (err) { reject(err); return; }
      t.oncomplete = () => resolve(result && result.__req ? result.__req.result : result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    }));
  }

  const wrap = req => ({ __req: req });

  /* ---- kv ------------------------------------------------------------- */

  const get = key => tx("kv", "readonly", s => wrap(s.get(key)));
  const set = (key, value) => tx("kv", "readwrite", s => { s.put(value, key); });
  const del = key => tx("kv", "readwrite", s => { s.delete(key); });

  /* ---- snapshot ------------------------------------------------------- */

  /** The last full read of the Sheet, plus when it was taken. */
  function saveSnapshot(data) {
    return set("snapshot", {
      contacts: data.contacts || [],
      directory: data.directory || [],
      encounters: data.encounters || [],
      sheetHealth: data.sheetHealth || { warnings: [] },
      fetchedAt: Date.now(),
      serverTime: data.serverTime || null
    });
  }

  const loadSnapshot = () => get("snapshot");

  /* ---- queue ---------------------------------------------------------- */

  /**
   * Durable before anything else happens. Called synchronously from the capture
   * form's submit handler; the UI does not confirm until this promise resolves.
   */
  function enqueue(encounter) {
    return tx("queue", "readwrite", s => { s.put(encounter); }).then(() => encounter);
  }

  const queued = () => tx("queue", "readonly", s => wrap(s.getAll()));
  const queueCount = () => tx("queue", "readonly", s => wrap(s.count()));

  /**
   * Removes only the clientIds the server confirmed it wrote (or already had).
   * Anything the server did not mention stays queued and is retried. A dropped
   * connection mid-response therefore costs a duplicate attempt, never a lost row —
   * and the duplicate is refused server-side on the Client ID.
   */
  function acknowledge(clientIds) {
    if (!clientIds || !clientIds.length) return Promise.resolve(0);
    return tx("queue", "readwrite", s => {
      clientIds.forEach(id => { if (id) s.delete(id); });
      return clientIds.length;
    });
  }

  /* ---- sync log ------------------------------------------------------- */

  function logEvent(kind, message) {
    const entry = { at: Date.now(), kind, message: String(message).slice(0, 300) };
    return tx("log", "readwrite", s => { s.add(entry); })
      .then(() => trimLog())
      .catch(() => {}); // diagnostics must never break a sync
  }

  function trimLog() {
    return tx("log", "readwrite", s => {
      const req = s.getAllKeys();
      req.onsuccess = () => {
        const keys = req.result;
        if (keys.length > 60) keys.slice(0, keys.length - 60).forEach(k => s.delete(k));
      };
    });
  }

  const readLog = () => tx("log", "readonly", s => wrap(s.getAll()))
    .then(entries => (entries || []).slice().reverse());

  /* ---- settings ------------------------------------------------------- */
  /* Small user-local preferences. Never synced, never sent to the Sheet. */

  const loadSettings = () => get("settings").then(v => v || {});
  const saveSettings = patch =>
    loadSettings().then(current => set("settings", Object.assign({}, current, patch)));

  return {
    get, set, del,
    saveSnapshot, loadSnapshot,
    enqueue, queued, queueCount, acknowledge,
    logEvent, readLog,
    loadSettings, saveSettings
  };
})();
