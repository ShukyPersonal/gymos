// Gym Coach → Google Sheets sync
// Deploy as: Web app, Execute as: Me, Who has access: Anyone

// Hardcoded so the script works no matter which Apps Script editor it was
// pasted into. Get the ID from the spreadsheet URL between /d/ and /edit.
const WORKOUTS_SS_ID = 'YOUR_SPREADSHEET_ID';

function _ss() {
  return SpreadsheetApp.openById(WORKOUTS_SS_ID);
}

function getOrCreateSheet(name, headers) {
  const ss = _ss();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  }
  return sheet;
}

// Read the Workouts tab and return it grouped as sessions, so the app can
// restore local history after a reinstall (AsyncStorage is wiped on uninstall).
// Hit this with a GET on the deployed web-app URL.
function doGet(e) {
  try {
    const ss = _ss();
    const sheet = ss.getSheetByName('Workouts');
    if (!sheet) return ok({ sessions: [], debug: { ssName: ss.getName(), sheetNames: ss.getSheets().map(function(s){return s.getName();}) } });
    const data = sheet.getDataRange().getValues();
    if (data.length < 2) return ok({ sessions: [] });

    const byDate = {};
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const dateVal = row[0];
      if (!dateVal) continue;

      let key;
      if (dateVal instanceof Date) {
        key = Utilities.formatDate(dateVal, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      } else if (typeof dateVal === 'string' && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateVal)) {
        const parts = dateVal.split('/').map(Number);
        key = parts[2] + '-' + String(parts[1]).padStart(2, '0') + '-' + String(parts[0]).padStart(2, '0');
      } else {
        continue;
      }

      if (!byDate[key]) byDate[key] = [];
      byDate[key].push({
        exercise_id: String(row[1] || ''),
        set_num: Number(row[2]) || 0,
        weight: row[3] === '' || row[3] == null ? null : Number(row[3]),
        reps: row[4] === '' || row[4] == null ? null : Number(row[4]),
        target_reps: row[5] === '' || row[5] == null ? null : Number(row[5]),
        skipped: row[7] === 'Yes',
      });
    }

    const sessions = Object.keys(byDate).sort().map(function(key) {
      return {
        date: key + 'T12:00:00.000Z',
        duration_min: 0,
        sets: byDate[key],
      };
    });

    return ok({ sessions: sessions });
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    if (data.type === 'crash') {
      const sheet = getOrCreateSheet('Crashes', ['Timestamp', 'Error', 'Stack', 'Context']);
      sheet.appendRow([data.timestamp, data.error, data.stack, data.context]);
      return ok({ rows: 1 });
    }

    // workout rows
    const sheet = getOrCreateSheet('Workouts', ['Date', 'Exercise', 'Set #', 'Weight (kg)', 'Reps', 'Target Reps', 'Hit Target', 'Skipped']);
    for (const row of data.rows) {
      sheet.appendRow(row);
    }
    return ok({ rows: data.rows.length });

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function ok(extra) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok', ...extra }))
    .setMimeType(ContentService.MimeType.JSON);
}
