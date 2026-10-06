/**
 * DeepIP Event App Kit - Sales Field API
 * Google Apps Script backend, BOUND to the event's field guide Sheet.
 *
 * Create it from inside the Sheet: Extensions > Apps Script. Never standalone,
 * otherwise the spreadsheets.currentonly scope in appsscript.json stops working.
 *
 * The Sheet is the database. This script exposes exactly two things over HTTP:
 *   action 'data'  -> a full read-only snapshot (contacts + directory + encounters)
 *   action 'sync'  -> appends queued encounters to the write tab, optionally + a fresh snapshot
 *
 * Rules, proven over two events, that must survive every copy of this file:
 *   - POST only. The Google ID token travels in the request body, never in the URL.
 *   - Deployed as "Anyone" (a domain-restricted deployment returns no CORS headers),
 *     access enforced in code: verified token, email_verified, hd === the allowed domain.
 *   - Every column is resolved by header TEXT at runtime. No hardcoded indexes or letters.
 *   - The header row is not assumed to be row 1: findHeaderRow() scores candidate rows,
 *     because every tab tends to grow a title and an instructions preamble.
 *   - Writes are append-only and idempotent, keyed on a client-generated "Client ID".
 *     An offline queue that retries after a timeout must never double-write a row.
 *
 * WHAT YOU EDIT IN THIS FILE: the configuration block and the three column maps,
 * down to the "HTTP" section. Below that line, nothing is event-specific.
 *
 * AFTER EDITING: Deploy > Manage deployments > pencil > New version > Deploy.
 * Saving the file changes nothing that is served. The URL stays the same, which
 * is exactly why people believe they have shipped when they have not.
 */

// --- Configuration -------------------------------------------------------

// The Sheet this script is bound to. Used only to warn when the binding is wrong.
var SHEET_ID = ''; // paste the Sheet ID in the bound copy only; kept out of the repo

// Tab names are NOT frozen the way column headers are: a Sheet gets renamed
// mid-preparation more often than anyone expects, and a hardcoded constant turns
// that into a total read failure with an error that does not even say which tabs
// exist.
//
// Each tab is resolved in three steps: exact name, then name ignoring punctuation
// and spacing, then by the SHAPE of its header row. However it resolves, the name
// chosen is reported in sheetHealth and shown in the app's Settings, so a wrong
// guess is visible rather than silent.
//
// Put the current name first and keep the old ones. An alias costs nothing and
// means a rename mid-event does not need a redeploy.
//
// Example, from a past event:
//   contacts:   ['1. FICPI - All', '1. Masterclass'],
//   directory:  ['2. FICPI Directory', '2. Directory'],
//   encounters: ['3. On site']
var TAB_NAMES = {
  contacts:   ['Attendees List', 'Attendee List'],
  // No second list at this event: the Attendees List already covers almost the
  // whole registered audience. Same tab, empty DIRECTORY_COLUMNS below -> empty
  // directory, no warnings.
  directory:  ['Attendees List', 'Attendee List'],
  encounters: ['Encounters']
};

var ALLOWED_DOMAIN = 'deepip.ai';

// The OAuth 2.0 Web Client ID from the Google Cloud console. One client is reused
// across events; its authorised JavaScript origins must cover wherever the app is
// served from. Must be byte-identical to GOOGLE_CLIENT_ID in config.js.
var CLIENT_ID = '810262336028-7a92202r99cp09pv0s8gf5g5idsrer3u.apps.googleusercontent.com';

// How many rows to scan at the top of a tab when hunting for the header row.
var HEADER_SCAN_DEPTH = 25;

// --- Column maps ---------------------------------------------------------
// key -> list of acceptable header texts, tried in order. For each candidate an
// EXACT match wins before a PREFIX match, so a header later annotated with an
// emoji, a unit or a note still resolves.
//
// `required: false` columns render as empty when absent: the app degrades, it does
// not break. That is deliberate, because columns get added to a live Sheet mid-event.
//
// These maps are the part that changes per event. Phase A produces them from the
// real header rows of the Sheet. Delete what this event does not have, add what it
// does, and never rename a header once the Sheet is live.

// AI & IP Summit USA 2026, tab "Attendees List". Keys read by buildContacts, plus
// any extra key below, which is passed through to the app as is (CARD_FIELDS,
// LIST_FIELDS and LIST_FILTERS in config.js read them). Keys starting with
// `guard` are carried for collision guarding only and never sent.
//
// Collision watch: `Company` prefix-matches `Company Record ID` and `Company Owner`.
// Those are declared BEFORE `firm`, so if `Company` is ever renamed, `firm` lands on
// a column that is already claimed and is dropped with a warning, instead of
// silently reading an owner's name as the firm.
//
// Joining key for the follow-up: Email Address lowercased, fallback First Name +
// Last Name + Company. Phone and LinkedIn columns are deliberately not read.
var CONTACT_COLUMNS = {
  ownership:       { headers: ['Company Owner'],                 required: false },
  guardCompanyId:  { headers: ['Company Record ID'],             required: false }, // guard only
  firm:            { headers: ['Company'],                       required: true  },
  firstName:       { headers: ['First Name'],                    required: true  },
  lastName:        { headers: ['Last Name'],                     required: true  },
  email:           { headers: ['Email Address', 'Email'],        required: false },
  role:            { headers: ['Job Title'],                     required: false },
  country:         { headers: ['Country'],                       required: false },
  sdr:             { headers: ['Prospecting SDR'],               required: false },
  // Lifecycle "Customer" raises the customer banner on the card.
  accountStatus:   { headers: ['Lifecycle'],                     required: false },
  tiering:         { headers: ['Tiering (New 2026)', 'Tiering'], required: false },
  openDeal:        { headers: ['Has Open or Won Deal'],          required: false },
  targetAccount:   { headers: ['Target Account'],                required: false },
  region:          { headers: ['Region'],                        required: false },
  competitorClient:{ headers: ["Competitor's client"],           required: false }
};

// The second list, searched when someone is not in the main population: a delegate
// directory, a member list, an exhibitor list. Often a single name column, which is
// why fullName is required here and split names are not.
// No second list (see TAB_NAMES). Empty on purpose.
var DIRECTORY_COLUMNS = {};

// Columns the app writes to the encounters tab.
//
// DECLARATION ORDER IS PRIORITY ORDER. When two logical fields resolve to the same
// column, the later one is dropped rather than allowed to overwrite the first. That
// is why metBy is declared before met: "met by" prefix-matches "met", and letting a
// Yes/No overwrite an author's name poisons the export silently.
//
// Names are stored SPLIT. lastName is the required one: a card read in a noisy room
// sometimes yields only a surname, and that row is still worth writing. Splitting a
// full name afterwards is guesswork on particles, double barrels and reversed order,
// and it has to be redone on every export.
// Tab "Encounters". Append only, idempotent on Client ID.
// DECLARATION ORDER IS PRIORITY ORDER: metBy before met, and `met` is headed
// `Met status` so it can never land on `Met by`. `captureMethod` (from the file,
// from search, typed on site) is headed `Source`. Extra fields from CAPTURE_EXTRA
// in config.js follow the core ones, one frozen header each.
//
// Second header in each list: the names used by the tab as first created (6 Oct),
// copied from the previous event. The app reads and writes either.
// Contact columns on that tab (Company Owner, Prospecting SDR, Tiering,
// Lifecycle, Organization type, Domain) are not written by the app: they are
// joined back from the Attendees List at export.
var ENCOUNTER_COLUMNS = {
  clientId:        { headers: ['Client ID'],                    required: false },
  date:            { headers: ['Date'],                         required: true  },
  capturedAt:      { headers: ['Captured at'],                  required: false },
  metBy:           { headers: ['Met by'],                       required: true  },
  session:         { headers: ['Session / moment', 'Session'],  required: false },
  lastName:        { headers: ['Last name'],                    required: true  },
  firstName:       { headers: ['First name'],                   required: false },
  firm:            { headers: ['Firm', 'Company name'],         required: false },
  email:           { headers: ['Email', 'Work Email'],          required: false },
  met:             { headers: ['Met status'],                   required: false },
  temperature:     { headers: ['Temperature'],                  required: false },
  toolToday:       { headers: ['Tool today'],                   required: false },
  nextStep:        { headers: ['Next step'],                    required: false },
  hook:            { headers: ['Hook', 'Observation'],          required: false },
  practitioners:   { headers: ['Practitioners', 'Number of Practitioners'], required: false },
  draftingModel:   { headers: ['Drafting model'],               required: false },
  purchaseSignOff: { headers: ['Tool purchase sign-off'],       required: false },
  otherTools:      { headers: ['Other tools'],                  required: false },
  technicalField:  { headers: ['Technical field'],              required: false },
  captureMethod:   { headers: ['Source'],                       required: false },
  role:            { headers: ['Job Title', 'Role'],            required: false }
};

// Ties each logical tab to its name aliases and to the column map that describes
// its shape. `minRatio` is how much of that map a tab must satisfy before we are
// willing to identify it by shape alone; the write tab is held to a higher bar,
// because appending to the wrong sheet is the one mistake with no undo.
var TAB_SPECS = {
  contacts:   { names: TAB_NAMES.contacts,   map: CONTACT_COLUMNS,   label: 'contacts',   minRatio: 0.5 },
  directory:  { names: TAB_NAMES.directory,  map: DIRECTORY_COLUMNS, label: 'directory',  minRatio: 0.5 },
  encounters: { names: TAB_NAMES.encounters, map: ENCOUNTER_COLUMNS, label: 'encounters', minRatio: 0.6 }
};

// =========================================================================
// Nothing below this line is event-specific. Edit it only to change how the
// backend behaves for every event.
// =========================================================================

// --- HTTP ----------------------------------------------------------------
// No doGet on purpose: a plain GET must not be able to read this Sheet.

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);

    var user = verifyToken(payload.token);
    if (!user) {
      // `auth:false` is the signal the frontend uses to drop into offline mode.
      // It must never be treated as "sign in again" - see app.js, onAuthFailure.
      return jsonResponse({ ok: false, auth: false, error: 'unauthorized' });
    }

    var action = payload.action || 'data';
    if (action === 'data') return jsonResponse(getSnapshot(user));
    if (action === 'sync') return jsonResponse(syncEncounters(payload, user));

    return jsonResponse({ ok: false, error: 'unknown action: ' + action });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

// --- Read ----------------------------------------------------------------

function getSnapshot(user) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var warnings = [];

  if (SHEET_ID && ss.getId() !== SHEET_ID) {
    warnings.push('This script is bound to a different Sheet than the one in SHEET_ID.');
  }

  var contactsTable  = readTable(ss, 'contacts', warnings);
  var directoryTable = readTable(ss, 'directory', warnings);
  var encounterTable = readTable(ss, 'encounters', warnings);

  return {
    ok: true,
    auth: true,
    user: { email: user.email },
    serverTime: new Date().toISOString(),
    contacts: buildContacts(contactsTable),
    directory: buildDirectory(directoryTable),
    encounters: buildEncounters(encounterTable),
    sheetHealth: {
      warnings: warnings,
      // Which tab each collection actually came from. On screen in Settings, so
      // "it resolved to the wrong tab" is something a user can see and report.
      tabs: {
        contacts: contactsTable.sheet.getName(),
        directory: directoryTable.sheet.getName(),
        encounters: encounterTable.sheet.getName()
      }
    }
  };
}

function buildContacts(t) {
  var out = [];
  for (var i = 0; i < t.rows.length; i++) {
    var r = t.rows[i];
    var first = cell(r, t.cols, 'firstName');
    var last  = cell(r, t.cols, 'lastName');
    var firm  = cell(r, t.cols, 'firm');
    if (!first && !last && !firm) continue; // genuinely blank row

    out.push({
      row: t.rowNumbers[i],
      firstName: first,
      lastName: last,
      firm: firm,
      track: cell(r, t.cols, 'track'),
      suggestedPrio: cell(r, t.cols, 'suggestedPrio'),
      priority: cell(r, t.cols, 'priority'),
      role: cell(r, t.cols, 'role'),
      country: cell(r, t.cols, 'country'),
      seniority: cell(r, t.cols, 'seniority'),
      aiMaturity: cell(r, t.cols, 'aiMaturity'),
      technicalField: cell(r, t.cols, 'technicalField'),
      accountStatus: cell(r, t.cols, 'accountStatus'),
      tiering: cell(r, t.cols, 'tiering'),
      engagement: cell(r, t.cols, 'engagement'),
      signal: cell(r, t.cols, 'signal'),
      arr: cell(r, t.cols, 'arr'),
      practitioners: cell(r, t.cols, 'practitioners'),
      sameFirmCount: cell(r, t.cols, 'sameFirmCount'),
      crmOwner: cell(r, t.cols, 'crmOwner'),
      crmRecord: linkCell(t.sheet, t.rowNumbers[i], t.cols.crmRecord, cell(r, t.cols, 'crmRecord')),
      email: cell(r, t.cols, 'email'),
      clientRef: cell(r, t.cols, 'clientRef'),
      dinner: cell(r, t.cols, 'dinner'),
      invitedBy: cell(r, t.cols, 'invitedBy'),
      knowThem: cell(r, t.cols, 'knowThem'),
      fieldNotes: cell(r, t.cols, 'fieldNotes'),
      ownership: cell(r, t.cols, 'ownership'),
      angle: cell(r, t.cols, 'angle'),
      removed: cell(r, t.cols, 'removed'),
      conversations: cell(r, t.cols, 'conversations'),
      projects: cell(r, t.cols, 'projects'),
      lastCrm: cell(r, t.cols, 'lastCrm')
    });
    passThrough(out[out.length - 1], r, t.cols, CONTACT_COLUMNS);
  }
  return out;
}

/**
 * Event-specific keys declared in a column map but not named in the builder
 * above are sent as they are, so a new column needs a map entry and nothing
 * else. `guard*` keys exist only to claim a column and are never sent.
 */
function passThrough(obj, r, cols, map) {
  Object.keys(map).forEach(function (key) {
    if (key.indexOf('guard') === 0 || obj.hasOwnProperty(key)) return;
    obj[key] = cell(r, cols, key);
  });
  return obj;
}

function buildDirectory(t) {
  var out = [];
  for (var i = 0; i < t.rows.length; i++) {
    var r = t.rows[i];
    var name = cell(r, t.cols, 'fullName');
    if (!name) continue;
    out.push({
      title: cell(r, t.cols, 'title'),
      fullName: name,
      firm: cell(r, t.cols, 'firm'),
      country: cell(r, t.cols, 'country'),
      city: cell(r, t.cols, 'city'),
      attendee: cell(r, t.cols, 'attendee'),
      targetAccount: cell(r, t.cols, 'targetAcct'),
      email: cell(r, t.cols, 'email')
    });
  }
  return out;
}

function buildEncounters(t) {
  var out = [];
  for (var i = 0; i < t.rows.length; i++) {
    var r = t.rows[i];
    var last  = cell(r, t.cols, 'lastName');
    var first = cell(r, t.cols, 'firstName');
    if (!last && !first) continue;
    out.push({
      row: t.rowNumbers[i],
      clientId: cell(r, t.cols, 'clientId'),
      date: isoOrText(rawCell(r, t.cols, 'date')),
      capturedAt: isoOrText(rawCell(r, t.cols, 'capturedAt')),
      session: cell(r, t.cols, 'session'),
      metBy: cell(r, t.cols, 'metBy'),
      lastName: last,
      firstName: first,
      firm: cell(r, t.cols, 'firm'),
      country: cell(r, t.cols, 'country'),
      role: cell(r, t.cols, 'role'),
      inList: cell(r, t.cols, 'inList'),
      inDirectory: cell(r, t.cols, 'inDirectory'),
      met: cell(r, t.cols, 'met'),
      temperature: cell(r, t.cols, 'temperature'),
      toolToday: cell(r, t.cols, 'toolToday'),
      practitioners: cell(r, t.cols, 'practitioners'),
      hook: cell(r, t.cols, 'hook'),
      nextStep: cell(r, t.cols, 'nextStep'),
      captureMethod: cell(r, t.cols, 'captureMethod'),
      observation: cell(r, t.cols, 'observation'),
      contactRef: cell(r, t.cols, 'contactRef'),
      modifiedBy: cell(r, t.cols, 'modifiedBy')
    });
    passThrough(out[out.length - 1], r, t.cols, ENCOUNTER_COLUMNS);
  }
  return out;
}

// --- Write ---------------------------------------------------------------

function syncEncounters(payload, user) {
  var items = payload.encounters || [];
  var lock = LockService.getScriptLock();
  lock.waitLock(30000); // the whole team can sync at the same moment

  var written = [], skipped = [], failed = [];
  try {
    if (items.length) {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var sheet = resolveTab(ss, 'encounters', null);

      var headerRow = findHeaderRow(sheet, ENCOUNTER_COLUMNS);
      var cols = resolveColumns(sheet, headerRow, ENCOUNTER_COLUMNS, []);
      var width = sheet.getLastColumn();

      // Idempotency. Read every Client ID already on the tab once, then refuse to
      // write one twice. Without this, a queued capture that times out on a bad
      // connection lands on the Sheet twice when the retry succeeds.
      var seen = {};
      if (cols.clientId) {
        var lastRow = sheet.getLastRow();
        if (lastRow > headerRow) {
          var ids = sheet.getRange(headerRow + 1, cols.clientId, lastRow - headerRow, 1).getValues();
          for (var k = 0; k < ids.length; k++) {
            var id = (ids[k][0] || '').toString().trim();
            if (id) seen[id] = true;
          }
        }
      }

      var pending = [];
      for (var i = 0; i < items.length; i++) {
        var enc = items[i];
        if (enc.clientId && seen[enc.clientId]) { skipped.push(enc.clientId); continue; }
        try {
          pending.push(encounterToRow(enc, cols, width, user.email));
          if (enc.clientId) seen[enc.clientId] = true;
          written.push(enc.clientId);
        } catch (rowErr) {
          failed.push({ clientId: enc.clientId, error: String(rowErr.message || rowErr) });
        }
      }

      if (pending.length) {
        sheet.getRange(sheet.getLastRow() + 1, 1, pending.length, width).setValues(pending);
        SpreadsheetApp.flush();
      }
    }
  } finally {
    lock.releaseLock();
  }

  var result = { ok: true, auth: true, written: written, skipped: skipped, failed: failed };

  // One round-trip does both jobs: flush the queue and come back with fresh data.
  // On conference wifi, halving the number of requests is worth more than tidiness.
  if (payload.includeData) {
    var snap = getSnapshot(user);
    result.contacts = snap.contacts;
    result.directory = snap.directory;
    result.encounters = snap.encounters;
    result.sheetHealth = snap.sheetHealth;
    result.serverTime = snap.serverTime;
    result.user = snap.user;
  }
  return result;
}

function encounterToRow(enc, cols, width, editorEmail) {
  var row = [];
  for (var i = 0; i < width; i++) row.push('');

  function put(key, value) {
    if (cols[key] && value !== undefined && value !== null && value !== '') {
      row[cols[key] - 1] = value;
    }
  }

  // The timestamp is the moment of CAPTURE, sent by the client, not the moment of
  // sync. A capture made offline at 09:12 and flushed at 13:40 reads 09:12.
  var when = enc.capturedAt ? new Date(enc.capturedAt) : new Date();
  if (isNaN(when.getTime())) when = new Date();

  put('date', when);
  put('capturedAt', enc.capturedAt || when.toISOString());
  put('session', enc.session);
  put('metBy', enc.metBy);
  put('lastName', enc.lastName);
  put('firstName', enc.firstName);
  put('firm', enc.firm);
  put('country', enc.country);
  put('role', enc.role);
  put('inList', enc.inList);
  put('inDirectory', enc.inDirectory);
  put('met', enc.met);
  put('temperature', enc.temperature);
  put('toolToday', enc.toolToday);
  put('practitioners', enc.practitioners);
  put('hook', enc.hook);
  put('nextStep', enc.nextStep);
  put('captureMethod', enc.captureMethod);
  put('observation', enc.observation);
  put('contactRef', enc.contactRef);
  put('clientId', enc.clientId);

  // Extra capture fields (CAPTURE_EXTRA in config.js): any other key declared in
  // ENCOUNTER_COLUMNS goes to its own column, so a new field needs a map entry
  // and nothing else.
  var written = { date: 1, capturedAt: 1, session: 1, metBy: 1, lastName: 1, firstName: 1,
    firm: 1, country: 1, role: 1, inList: 1, inDirectory: 1, met: 1, temperature: 1,
    toolToday: 1, practitioners: 1, hook: 1, nextStep: 1, captureMethod: 1,
    observation: 1, contactRef: 1, clientId: 1, modifiedBy: 1 };
  Object.keys(ENCOUNTER_COLUMNS).forEach(function (key) {
    if (!written[key]) put(key, enc[key]);
  });

  // Attribution: the Web App runs as the deployer, so the Sheet's revision history
  // credits everything to that one account. Record the real editor.
  put('modifiedBy', editorEmail);

  // A row with no name at all cannot be reconciled with anything afterwards. A row
  // with only a surname can. That is why the guard is on lastName alone.
  if (!row[cols.lastName - 1]) throw new Error('Encounter has no last name');
  return row;
}

// --- Column resolution ---------------------------------------------------

/**
 * Reads a whole tab into { sheet, cols, rows, rowNumbers }.
 * `rows` excludes the preamble and the header row itself.
 */
function readTable(ss, kind, warnings) {
  var sheet = resolveTab(ss, kind, warnings);
  var columnMap = TAB_SPECS[kind].map;

  var headerRow = findHeaderRow(sheet, columnMap);
  var cols = resolveColumns(sheet, headerRow, columnMap, warnings, sheet.getName());

  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  var rows = [], rowNumbers = [];
  if (lastRow > headerRow) {
    rows = sheet.getRange(headerRow + 1, 1, lastRow - headerRow, lastCol).getValues();
    for (var i = 0; i < rows.length; i++) rowNumbers.push(headerRow + 1 + i);
  }
  return { sheet: sheet, headerRow: headerRow, cols: cols, rows: rows, rowNumbers: rowNumbers };
}

/**
 * Finds the sheet for a logical tab: exact name, then name ignoring punctuation
 * and spacing, then by the shape of its header row. Throws with the list of tabs
 * that DO exist, because "not found" alone costs a whole extra round-trip to
 * discover names that were sitting right there.
 */
function resolveTab(ss, kind, warnings) {
  var spec = TAB_SPECS[kind];
  var sheets = ss.getSheets();
  var i, j;

  // 1. Exact name, trimmed and case-insensitive.
  for (i = 0; i < spec.names.length; i++) {
    var target = spec.names[i].trim().toLowerCase();
    for (j = 0; j < sheets.length; j++) {
      if (sheets[j].getName().trim().toLowerCase() === target) return sheets[j];
    }
  }

  // 2. Same name modulo punctuation and spacing: a double space, a trailing space
  //    someone left behind, a dash that became a dot. These are not real renames.
  for (i = 0; i < spec.names.length; i++) {
    var loose = looseName(spec.names[i]);
    for (j = 0; j < sheets.length; j++) {
      if (looseName(sheets[j].getName()) === loose) {
        if (warnings) {
          warnings.push('Tab "' + sheets[j].getName() + '" was matched loosely against "' +
            spec.names[i] + '". Add the exact name to TAB_NAMES.' + kind + '.');
        }
        return sheets[j];
      }
    }
  }

  // 3. By shape. A tab qualifies only if every REQUIRED column of the map is
  //    present, and it must beat the runner-up clearly: an ambiguous guess on which
  //    tab holds the data is worse than a clear failure.
  var scored = [];
  for (j = 0; j < sheets.length; j++) {
    var sc = scoreTab(sheets[j], spec.map);
    if (sc) scored.push({ sheet: sheets[j], score: sc.score, ratio: sc.ratio });
  }
  scored.sort(function (a, b) { return b.score - a.score; });

  if (scored.length && scored[0].ratio >= spec.minRatio &&
      (scored.length === 1 || scored[0].score > scored[1].score + 2)) {
    if (warnings) {
      warnings.push('Tab "' + scored[0].sheet.getName() + '" was identified as the ' +
        spec.label + ' tab by its columns, not its name. Add it to TAB_NAMES.' + kind + '.');
    }
    return scored[0].sheet;
  }

  var available = [];
  for (j = 0; j < sheets.length; j++) available.push('"' + sheets[j].getName() + '"');
  var ambiguous = scored.length > 1 && scored[0].ratio >= spec.minRatio
    ? ' Two tabs look alike: ' + scored[0].sheet.getName() + ' and ' + scored[1].sheet.getName() + '.'
    : '';
  throw new Error('Could not find the ' + spec.label + ' tab. Looked for: ' +
    spec.names.join(', ') + '.' + ambiguous +
    ' Tabs in this Sheet: ' + available.join(', ') +
    '. Fix TAB_NAMES.' + kind + ' at the top of Code.gs.');
}

/** Name reduced to its letters and digits, for tolerant comparison. */
function looseName(name) {
  return (name || '').toString().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * How well a sheet fits a column map. Returns null when a required column is
 * missing: that is a hard disqualification, and it is what keeps the directory tab
 * from ever being mistaken for the contacts tab, or the contacts tab for the
 * encounters tab.
 */
function scoreTab(sheet, columnMap) {
  try {
    if (sheet.getLastRow() < 1 || sheet.getLastColumn() < 1) return null;
    var headerRow = findHeaderRow(sheet, columnMap);
    var headers = sheet.getRange(headerRow, 1, 1, sheet.getLastColumn()).getValues()[0];
    var keys = Object.keys(columnMap);
    var found = 0, qualifies = true;
    keys.forEach(function (key) {
      if (matchHeader(headers, columnMap[key].headers) > -1) found++;
      else if (columnMap[key].required) qualifies = false;
    });
    if (!qualifies) return null;
    return { score: found, ratio: found / keys.length };
  } catch (err) {
    return null; // an empty or exotic tab simply does not qualify
  }
}

/**
 * The header row is rarely row 1: every tab tends to open with a title,
 * instructions and blank spacer rows, and more get added. So instead of assuming a
 * position, score the first HEADER_SCAN_DEPTH rows by how many of the expected
 * headers they contain and take the best. Ties go to the earliest row.
 */
function findHeaderRow(sheet, columnMap) {
  var lastCol = sheet.getLastColumn();
  var depth = Math.min(HEADER_SCAN_DEPTH, sheet.getLastRow());
  if (depth < 1 || lastCol < 1) throw new Error('Tab "' + sheet.getName() + '" is empty.');

  var block = sheet.getRange(1, 1, depth, lastCol).getValues();
  var bestRow = 1, bestScore = -1;

  for (var r = 0; r < depth; r++) {
    var score = 0;
    Object.keys(columnMap).forEach(function (key) {
      if (matchHeader(block[r], columnMap[key].headers) > -1) score++;
    });
    if (score > bestScore) { bestScore = score; bestRow = r + 1; }
  }
  return bestRow;
}

/** Resolves every key in the map to a 1-based column number (0 when absent). */
function resolveColumns(sheet, headerRow, columnMap, warnings, tabName) {
  var headers = sheet.getRange(headerRow, 1, 1, sheet.getLastColumn()).getValues()[0];
  var cols = {};

  Object.keys(columnMap).forEach(function (key) {
    var spec = columnMap[key];
    var idx = matchHeader(headers, spec.headers);
    if (idx === -1) {
      if (spec.required) {
        throw new Error('Required column "' + spec.headers[0] + '" not found on tab "' +
                        sheet.getName() + '" (header row ' + headerRow + ').');
      }
      cols[key] = 0;
      if (warnings && tabName) {
        warnings.push(tabName + ': no column starting with "' + spec.headers[0] + '", that field will be blank in the app.');
      }
    } else {
      cols[key] = idx + 1;
    }
  });

  resolveCollisions(sheet, headers, cols, warnings);
  return cols;
}

/**
 * Two logical fields resolving to the same column means one silently overwrites the
 * other on write. The exact-match rule in matchHeader removes the known cases, but
 * a collision comes straight back whenever the more specific column is simply
 * absent: with no "Met" header, `met` prefix-matches "Met by" all over again.
 *
 * So this does not merely warn. The LATER field is dropped (column 0) and the first
 * claim stands. Declaration order in the column maps is therefore priority order.
 * Losing a field degrades the row; corrupting a different field poisons the export,
 * and nobody notices until afterwards.
 */
function resolveCollisions(sheet, headers, cols, warnings) {
  var claimedBy = {};
  Object.keys(cols).forEach(function (key) {
    var col = cols[key];
    if (!col) return;
    if (claimedBy[col]) {
      cols[key] = 0; // drop the collider rather than let it overwrite
      if (warnings) {
        warnings.push(sheet.getName() + ': "' + key + '" collided with "' + claimedBy[col] +
          '" on column ' + col + ' ("' + headers[col - 1] + '"). "' + key +
          '" will be left blank. Add a distinct header for it.');
      }
    } else {
      claimedBy[col] = key;
    }
  });
}

/**
 * Returns the 0-based index of the header cell matching any of `candidates`
 * (case-insensitive, trimmed).
 *
 * For each candidate, an EXACT match anywhere in the row wins before a PREFIX match
 * anywhere in the row. That ordering is not cosmetic. On a real Sheet, "Met by" sat
 * in column C and "Met" in column O, and "met by" prefix-matches "met". Scanning
 * left to right for a prefix resolved BOTH fields to column C, so the capture's
 * Yes/No overwrote the author's name and the real Met column stayed empty. Silently,
 * and only on write.
 *
 * Prefix matching survives as the fallback, so a header later annotated to
 * "Tiering (2026 model)" or "Priority level 1-2-3" plus a symbol still resolves.
 *
 * Candidates are tried in order, exact-then-prefix each, so alias priority is
 * preserved: 'Firm (as declared)' still beats a plain 'Firm' column, because the
 * attendee's own declaration is the source of truth.
 */
function matchHeader(headerRow, candidates) {
  for (var ci = 0; ci < candidates.length; ci++) {
    var target = candidates[ci].toString().trim().toLowerCase();
    var exact = -1, prefix = -1;
    for (var c = 0; c < headerRow.length; c++) {
      var header = (headerRow[c] === null || headerRow[c] === undefined ? '' : headerRow[c])
                     .toString().trim().toLowerCase();
      if (!header) continue;
      if (header === target) { exact = c; break; }
      if (prefix === -1 && header.indexOf(target) === 0) prefix = c;
    }
    if (exact > -1) return exact;
    if (prefix > -1) return prefix;
  }
  return -1;
}

function cell(rowValues, cols, key) {
  var col = cols[key];
  if (!col) return '';
  var v = rowValues[col - 1];
  if (v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') return v.toISOString();
  return v.toString().trim();
}

function rawCell(rowValues, cols, key) {
  var col = cols[key];
  return col ? rowValues[col - 1] : '';
}

function isoOrText(v) {
  if (v === null || v === undefined || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]') return v.toISOString();
  return v.toString().trim();
}

/**
 * A CRM record column usually holds display text such as "Open in CRM" with the
 * real URL in the cell's hyperlink, so reading the value alone loses the link. Pull
 * the URL out of the rich-text link or the =HYPERLINK() formula; fall back to the
 * text when it is itself a URL.
 */
function linkCell(sheet, rowNumber, col, fallbackText) {
  if (!col) return '';
  try {
    var range = sheet.getRange(rowNumber, col);
    var rt = range.getRichTextValue();
    if (rt) {
      var url = rt.getLinkUrl();
      if (url) return url;
      var runs = rt.getRuns();
      for (var i = 0; i < runs.length; i++) {
        var runUrl = runs[i].getLinkUrl();
        if (runUrl) return runUrl;
      }
    }
    var formula = range.getFormula();
    if (formula) {
      var m = formula.match(/HYPERLINK\(\s*"([^"]+)"/i);
      if (m) return m[1];
    }
  } catch (err) {
    // Rich text is unavailable on some cell types; the text fallback is fine.
  }
  return /^https?:\/\//i.test(fallbackText) ? fallbackText : '';
}

// --- Authentication ------------------------------------------------------

/**
 * Verifies a Google ID token and confirms it belongs to the allowed Workspace
 * domain. Returns { email } when valid, or null when not. Results are cached
 * briefly (keyed on the token) so rapid syncs do not each hit Google.
 */
function verifyToken(token) {
  if (!token) return null;

  var cache = CacheService.getScriptCache();
  var cacheKey = 'tok_' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token)
  );
  var cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  var url = 'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token);
  var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) return null; // Google rejects bad or expired tokens

  var claims;
  try {
    claims = JSON.parse(resp.getContentText());
  } catch (err) {
    return null;
  }

  // The token must have been issued for OUR client, for a verified account, on the
  // allowed domain. `hd` (hosted domain) is only present for Workspace users.
  if (claims.aud !== CLIENT_ID) return null;
  if (String(claims.email_verified) !== 'true') return null;
  if (claims.hd !== ALLOWED_DOMAIN) return null;
  if (!claims.email || claims.email.toLowerCase().indexOf('@' + ALLOWED_DOMAIN) === -1) return null;

  var user = { email: claims.email };

  // Cache until shortly before the token expires, capped at 5 minutes.
  var ttl = 300;
  if (claims.exp) {
    var secondsLeft = parseInt(claims.exp, 10) - Math.floor(Date.now() / 1000);
    ttl = Math.max(0, Math.min(300, secondsLeft - 30));
  }
  if (ttl > 0) cache.put(cacheKey, JSON.stringify(user), ttl);

  return user;
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// --- Bench test ----------------------------------------------------------
// Run this from the Apps Script editor (Run > selfTest) after pasting the code and
// filling the configuration. It exercises tab resolution, header discovery and the
// read path without needing a token, and logs what it found. Nothing is written.
//
// Read the COUNTS at the end, not just the column listing. Column resolution can be
// perfect while the data still makes the app useless on the morning of day one.

function selfTest() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var warnings = [];

  var all = ss.getSheets().map(function (sh) { return '"' + sh.getName() + '"'; });
  Logger.log('Tabs in this Sheet: ' + all.join(', '));
  Logger.log('');

  ['contacts', 'directory', 'encounters'].forEach(function (kind) {
    var sheet;
    try {
      sheet = resolveTab(ss, kind, warnings);
    } catch (err) {
      Logger.log('CANNOT RESOLVE ' + kind + ': ' + err.message);
      return;
    }
    var map = TAB_SPECS[kind].map;
    var hr = findHeaderRow(sheet, map);
    var cols = resolveColumns(sheet, hr, map, warnings, sheet.getName());
    var found = Object.keys(cols).filter(function (k) { return cols[k]; });
    var missing = Object.keys(cols).filter(function (k) { return !cols[k]; });
    Logger.log(kind + ' -> tab "' + sheet.getName() + '", header row ' + hr +
               ', ' + found.length + ' columns resolved');
    if (missing.length) Logger.log('   missing: ' + missing.join(', '));
    found.forEach(function (k) {
      Logger.log('      ' + k + ' -> col ' + cols[k] + '  "' +
        sheet.getRange(hr, cols[k]).getValue() + '"');
    });
    Logger.log('');
  });

  var snap = getSnapshot({ email: 'selftest@' + ALLOWED_DOMAIN });
  Logger.log('contacts: ' + snap.contacts.length +
             ' | directory: ' + snap.directory.length +
             ' | encounters: ' + snap.encounters.length);

  var byTrack = {}, dinnerFlag = 0, owned = 0;
  snap.contacts.forEach(function (c) {
    var t = c.track || '(blank)';
    byTrack[t] = (byTrack[t] || 0) + 1;
    if (/^(yes|y|1|true)$/i.test(c.dinner)) dinnerFlag++;
    if (c.ownership) owned++;
  });
  Logger.log('by Track: ' + Object.keys(byTrack).map(function (k) {
    return k + ' ' + byTrack[k];
  }).join(' | '));
  Logger.log('flagged for the dinner: ' + dinnerFlag);
  Logger.log('Ownership filled: ' + owned + ' of ' + snap.contacts.length);
  if (!owned) {
    Logger.log('  ! "Assigned to me" is the DEFAULT view for anyone with a list.');
    Logger.log('  ! It will be empty on the morning of day one until Ownership is filled.');
  }
  if (!dinnerFlag) {
    Logger.log('  ! Nothing is flagged for the dinner, so that screen will be empty.');
    Logger.log('  ! The app reads the consolidated tab only: guests that live solely');
    Logger.log('  ! on a separate Dinner tab are invisible to it.');
  }
  var unkeyed = snap.encounters.filter(function (e) { return !e.clientId; });
  if (unkeyed.length) {
    Logger.log('  ! ' + unkeyed.length + ' encounter row(s) carry no Client ID (example or hand-typed).');
    Logger.log('  ! They count towards the evening recap. Delete example rows before day one.');
  }
  Logger.log('warnings: ' + (snap.sheetHealth.warnings.length || 'none'));
  snap.sheetHealth.warnings.forEach(function (w) { Logger.log('  ! ' + w); });

  var collisions = snap.sheetHealth.warnings.filter(function (w) {
    return w.indexOf('collided with') > -1;
  });
  if (collisions.length) {
    Logger.log('');
    Logger.log('*** Two fields resolved to the same column. The second is being dropped,');
    Logger.log('*** so nothing gets corrupted, but that field will be blank until you');
    Logger.log('*** add a distinct header for it.');
  }
}
