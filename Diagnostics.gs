/**
 * Optional second file for the bound Apps Script project. Paste it in as a new
 * file (+ > Script) next to Code.gs and run a function from the editor. It
 * changes nothing and writes nothing — and it needs no new deployment, because
 * running a function in the editor is not serving the web app.
 *
 * It answers the questions selfTest() cannot. selfTest() tells you a column
 * resolved; these tell you whether what is IN it reaches anybody.
 *
 *   findDroppedRows()      why the app sees fewer people than the tab has rows
 *   coverageLoad()         the distinct values in the field-zone columns
 *   unmatchedOwnership()   how many rows are assigned to nobody the app knows
 *   findDuplicatePeople()  two rows that are one person to the app
 *
 * It deliberately logs row numbers and column names, never cell values, so the
 * output can be pasted into a chat or a ticket without carrying a guest's name,
 * email or deal into it. The one exception is the team's own names in the
 * ownership column, which is the point of coverageLoad() and unmatchedOwnership().
 *
 * Two places to adjust per event, both marked EDIT below: the list of columns
 * coverageLoad() summarises, and the owner names unmatchedOwnership() matches.
 *
 * Depends on Code.gs being in the same project: resolveTab, findHeaderRow,
 * resolveColumns and cell all come from there.
 */

/**
 * Why the app sees fewer people than the tab has rows.
 *
 * buildContacts() skips a row when the first name, last name AND firm are all
 * empty, because a row with none of the three cannot be shown, searched or
 * joined to an encounter. That is the only row the app silently drops, and this
 * prints exactly which ones and what they do contain.
 *
 * A dropped row with nothing in it at all is almost always a formula dragged one
 * row too far — a consolidated tab is built from formulas against the source
 * tabs, and one extra row of them is enough to make the tab look longer than it
 * is. A dropped row that still has an email or a key is a real person with their
 * name missing, and they are invisible to the app until it is filled in.
 */
function findDroppedRows() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = resolveTab(ss, 'contacts', null);
  var headerRow = findHeaderRow(sheet, CONTACT_COLUMNS);
  var cols = resolveColumns(sheet, headerRow, CONTACT_COLUMNS, [], sheet.getName());
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();

  Logger.log('Tab "' + sheet.getName() + '", header row ' + headerRow +
             ', last row ' + lastRow + ' -> ' + (lastRow - headerRow) + ' data rows');

  if (lastRow <= headerRow) { Logger.log('No data rows at all.'); return; }

  var values = sheet.getRange(headerRow + 1, 1, lastRow - headerRow, lastCol).getValues();
  var headers = sheet.getRange(headerRow, 1, 1, lastCol).getValues()[0];

  var kept = 0, dropped = [];
  for (var i = 0; i < values.length; i++) {
    var r = values[i];
    var rowNumber = headerRow + 1 + i;
    if (cell(r, cols, 'firstName') || cell(r, cols, 'lastName') || cell(r, cols, 'firm')) {
      kept++; continue;
    }
    // What IS in this row, by column name, so it can be identified without
    // printing anything that was typed into it.
    var filled = [];
    for (var ci = 0; ci < lastCol; ci++) {
      var v = r[ci];
      if (v !== '' && v !== null && v !== undefined && String(v).trim() !== '') {
        filled.push(String(headers[ci] || ('column ' + (ci + 1))).trim());
      }
    }
    dropped.push({ row: rowNumber, filled: filled });
  }

  Logger.log('the app sees ' + kept + ' people');
  if (!dropped.length) {
    Logger.log('nothing dropped: every data row has a name or a firm.');
    Logger.log('So a count that disagrees with the app is a disagreement about');
    Logger.log('what is on the tab, not about what the app reads.');
    return;
  }
  Logger.log(dropped.length + ' row(s) dropped, because first name, last name and firm are all empty:');
  dropped.forEach(function (d) {
    Logger.log('  row ' + d.row + ' -> ' +
      (d.filled.length ? 'still has: ' + d.filled.join(', ') : 'completely empty'));
  });
  Logger.log('');
  Logger.log('"completely empty"           -> delete the row, nobody is missing.');
  Logger.log('"still has: <one formula column>" -> a formula dragged one row too far. Delete the row.');
  Logger.log('"still has: Email, ..."      -> a real guest with no name. Fill the name and');
  Logger.log('                                the firm, or they stay invisible to the app.');
}

/**
 * The distinct values actually sitting in the hand-filled columns, with counts.
 *
 * This is the fastest way to see, before the event rather than during it, that
 * a column everyone believes is filled is full of values the app cannot use:
 * a short name where a surname is expected, three spellings of the same firm,
 * a grade nobody configured.
 *
 * EDIT: the keys to summarise, as named in CONTACT_COLUMNS. A key that does not
 * exist in this event's map is reported and skipped, so an over-long list is safe.
 */
function coverageLoad() {
  var KEYS = ['ownership', 'priority', 'suggestedPrio', 'accountStatus', 'tiering'];

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = resolveTab(ss, 'contacts', null);
  var headerRow = findHeaderRow(sheet, CONTACT_COLUMNS);
  var cols = resolveColumns(sheet, headerRow, CONTACT_COLUMNS, [], sheet.getName());
  var lastRow = sheet.getLastRow();
  if (lastRow <= headerRow) { Logger.log('No data rows.'); return; }
  var values = sheet.getRange(headerRow + 1, 1, lastRow - headerRow, sheet.getLastColumn()).getValues();

  KEYS.forEach(function (key) {
    if (!cols[key]) { Logger.log(key + ': not mapped at this event, skipped'); return; }
    var counts = {}, blank = 0;
    values.forEach(function (r) {
      if (!cell(r, cols, 'firstName') && !cell(r, cols, 'lastName') && !cell(r, cols, 'firm')) return;
      var v = cell(r, cols, key);
      if (!v) { blank++; return; }
      counts[v] = (counts[v] || 0) + 1;
    });
    Logger.log('--- ' + sheet.getRange(headerRow, cols[key]).getValue() + ' ---');
    Object.keys(counts).sort().forEach(function (k) { Logger.log('  ' + counts[k] + '  ' + k); });
    if (blank) Logger.log('  ' + blank + '  (blank)');
    Logger.log('');
  });
  Logger.log('The ownership column must spell a name the app knows (config.js,');
  Logger.log('USERS.ownerNames). A value containing none of them gives that');
  Logger.log('person an empty list. unmatchedOwnership() counts them.');
}

/**
 * How many rows carry an ownership value that reaches nobody.
 *
 * Run it the moment the team has claimed their guests, and again the day before.
 * The failure it catches is silent: the app matches a user to a contact by
 * looking for one of their configured owner names inside the ownership cell, so
 * a cell holding a first name, a nickname, an initial or somebody who is not on
 * the floor matches nobody, and that contact simply never appears on anyone's
 * list. Nothing errors. selfTest() reports the column as filled and healthy.
 * The list is just quietly short.
 *
 * Prints the team's own names only — never a guest — so the log is safe to paste.
 *
 * EDIT: mirror USERS.ownerNames from config.js here, lower case, no accents.
 * Apps Script cannot read config.js, so this is the one place that duplicates it.
 * When someone joins or leaves the floor, change it in both.
 */
function unmatchedOwnership() {
  var OWNER_NAMES = ['surname-one', 'surname-two'];

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = resolveTab(ss, 'contacts', null);
  var headerRow = findHeaderRow(sheet, CONTACT_COLUMNS);
  var cols = resolveColumns(sheet, headerRow, CONTACT_COLUMNS, [], sheet.getName());
  if (!cols.ownership) { Logger.log('No ownership column found. Check the header.'); return; }
  var lastRow = sheet.getLastRow();
  if (lastRow <= headerRow) { Logger.log('No data rows.'); return; }
  var values = sheet.getRange(headerRow + 1, 1, lastRow - headerRow, sheet.getLastColumn()).getValues();

  var people = 0, blank = 0, matched = 0, perOwner = {}, unmatched = {};
  values.forEach(function (r) {
    if (!cell(r, cols, 'firstName') && !cell(r, cols, 'lastName') && !cell(r, cols, 'firm')) return;
    people++;
    var raw = cell(r, cols, 'ownership');
    if (!raw) { blank++; return; }
    var v = diagNorm(raw), hit = null;
    for (var i = 0; i < OWNER_NAMES.length; i++) {
      if (v.indexOf(OWNER_NAMES[i]) > -1) { hit = OWNER_NAMES[i]; break; }
    }
    if (hit) { matched++; perOwner[hit] = (perOwner[hit] || 0) + 1; }
    else unmatched[raw] = (unmatched[raw] || 0) + 1;
  });

  var bad = Object.keys(unmatched);
  Logger.log(people + ' people on the tab');
  Logger.log('  ' + matched + ' claimed by someone the app knows');
  Logger.log('  ' + blank + ' with ownership empty  -> on nobody\'s list, and no arrival banner');
  Logger.log('  ' + bad.reduce(function (n, k) { return n + unmatched[k]; }, 0) +
             ' with a value that matches no user in USERS');
  Logger.log('');
  Logger.log('--- per person, as the app will count it ---');
  Object.keys(perOwner).sort().forEach(function (k) { Logger.log('  ' + perOwner[k] + '  ' + k); });
  if (bad.length) {
    Logger.log('');
    Logger.log('--- values that reach nobody ---');
    bad.sort().forEach(function (k) { Logger.log('  ' + unmatched[k] + '  "' + k + '"'); });
    Logger.log('Each of these contacts is on no list. Either fix the cell, or add the');
    Logger.log('name to ownerNames in config.js (which needs a push, not a redeploy).');
  }
  if (blank) {
    Logger.log('');
    Logger.log(blank + ' unclaimed contact(s) raise no arrival banner for anyone. They are');
    Logger.log('still visible to everyone, and an owner-blind filter still shows them:');
    Logger.log('an empty ownership column hides nobody, it just helps nobody.');
  }
}

/**
 * Two rows that look like the same person to the app.
 *
 * Encounters are joined to contacts on normalised name + firm, never on a row
 * number, because rows move when a late drop is pasted in. Two rows with the
 * same name and firm therefore collapse into one card, and every capture made
 * against either of them lands on the first. Row numbers only, so the output
 * stays safe to paste.
 */
function findDuplicatePeople() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = resolveTab(ss, 'contacts', null);
  var headerRow = findHeaderRow(sheet, CONTACT_COLUMNS);
  var cols = resolveColumns(sheet, headerRow, CONTACT_COLUMNS, [], sheet.getName());
  var lastRow = sheet.getLastRow();
  if (lastRow <= headerRow) { Logger.log('No data rows.'); return; }
  var values = sheet.getRange(headerRow + 1, 1, lastRow - headerRow, sheet.getLastColumn()).getValues();

  var seen = {}, dupes = 0;
  for (var i = 0; i < values.length; i++) {
    var r = values[i], rowNumber = headerRow + 1 + i;
    var first = cell(r, cols, 'firstName'), last = cell(r, cols, 'lastName'), firm = cell(r, cols, 'firm');
    if (!first && !last && !firm) continue;
    var k = diagNorm(first + ' ' + last) + '|' + diagNorm(firm);
    if (seen[k]) { Logger.log('rows ' + seen[k] + ' and ' + rowNumber + ' are the same person to the app'); dupes++; }
    else seen[k] = rowNumber;
  }
  Logger.log(dupes ? dupes + ' duplicate(s). Merge or delete before the event.'
                   : 'No duplicates: every row is a distinct person to the app.');
}

/** Same normalisation the frontend matches on: lower case, no accents, no punctuation. */
function diagNorm(s) {
  return String(s == null ? '' : s).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}
