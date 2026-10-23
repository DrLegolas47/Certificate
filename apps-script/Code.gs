/**
 * GCS Certificate Verification & Issuance Portal - Google Apps Script Backend
 * Developed for GCS Medical College & Hospital / GCS Foundation
 * 
 * Deployment Instructions:
 * 1. Open your master Google Sheet in Google Drive.
 * 2. Click Extensions > Apps Script.
 * 3. Replace all existing code with this file.
 * 4. Click 'Deploy' > 'New deployment' > Select type: 'Web app'.
 * 5. Configuration:
 *    - Description: GCS Certificate Portal Backend
 *    - Execute as: 'Me' (your administrator email)
 *    - Who has access: 'Anyone'
 * 6. Copy the Web App URL (ends with '/exec') and paste it into Portal Admin Settings.
 */

var SHEET_CONFIG = 'CONFIG';
var SHEET_USERS = 'USERS';
var SHEET_LOGS = 'AUDIT_LOGS';

var CERT_HEADERS = [
  'ID',
  'RecipientName',
  'CertificateType',
  'DateIssued',
  'IssuedBy',
  'ReferenceNo',
  'Description',
  'TableData',
  'Status',
  'IssuedByUser',
  'CreatedAt',
  'ScanCount',
  'LastScannedAt'
];

// DEFAULT_CONFIG fallback defaults.
// HEADER_BRANDING, SUB_BRANDING and CONTACT_EMAIL are managed dynamically
// via the Portal Settings page and stored in the CONFIG sheet.
var DEFAULT_CONFIG = {
  PREFIX_URL: 'https://verify.jaydeep-ghevariya.workers.dev/?id=',
  HEADER_BRANDING: 'GCS Foundation',
  SUB_BRANDING: 'Certificate Verification Portal',
  CONTACT_EMAIL: 'info@gcsmc.org'
};

var DEFAULT_SUPER_ADMIN = {
  user_id: 'user-superadmin-jaydeep',
  name: 'Dr. Jaydeep Ghevariya',
  designation: 'Portal Administrator',
  login_id: 'jaydeep.ghevariya@gcsmc.org',
  password_hash: '1234567890@Abc',
  role: 'SUPER_ADMIN',
  active: 'TRUE',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z'
};

function getSpreadsheet_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function ensureSheet_(name, headers) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  if (headers && headers.length > 0) {
    var range = sheet.getDataRange();
    if (range.getNumRows() <= 1 && range.getNumColumns() <= 1 && !sheet.getRange(1, 1).getValue()) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    }
  }
  return sheet;
}

function ensureSystemSheets_() {
  ensureSheet_(SHEET_CONFIG, ['Key', 'Value', 'UpdatedAt']);
  ensureSheet_(SHEET_USERS, ['user_id', 'name', 'designation', 'login_id', 'password_hash', 'role', 'active', 'created_at', 'updated_at']);
  ensureSheet_(SHEET_LOGS, ['Timestamp', 'Action', 'CertificateID', 'User', 'Details', 'ClientInfo']);

  // Ensure default config
  var configSheet = ensureSheet_(SHEET_CONFIG);
  var configData = configSheet.getDataRange().getValues();
  var existingKeys = {};
  for (var i = 1; i < configData.length; i++) {
    if (configData[i][0]) existingKeys[configData[i][0]] = true;
  }
  var newConfigRows = [];
  var now = new Date().toISOString();
  for (var k in DEFAULT_CONFIG) {
    if (!existingKeys[k]) {
      newConfigRows.push([k, DEFAULT_CONFIG[k], now]);
    }
  }
  if (newConfigRows.length > 0) {
    configSheet.getRange(configSheet.getLastRow() + 1, 1, newConfigRows.length, 3).setValues(newConfigRows);
  }

  // Ensure default super admin
  var userSheet = ensureSheet_(SHEET_USERS);
  var userData = userSheet.getDataRange().getValues();
  var foundAdmin = false;
  for (var j = 1; j < userData.length; j++) {
    if (String(userData[j][3] || '').toLowerCase() === DEFAULT_SUPER_ADMIN.login_id.toLowerCase()) {
      foundAdmin = true;
      break;
    }
  }
  if (!foundAdmin) {
    userSheet.appendRow([
      DEFAULT_SUPER_ADMIN.user_id,
      DEFAULT_SUPER_ADMIN.name,
      DEFAULT_SUPER_ADMIN.designation,
      DEFAULT_SUPER_ADMIN.login_id,
      DEFAULT_SUPER_ADMIN.password_hash,
      DEFAULT_SUPER_ADMIN.role,
      DEFAULT_SUPER_ADMIN.active,
      DEFAULT_SUPER_ADMIN.created_at,
      DEFAULT_SUPER_ADMIN.updated_at
    ]);
  }
}

function loadConfig_() {
  ensureSystemSheets_();
  var sheet = ensureSheet_(SHEET_CONFIG);
  var data = sheet.getDataRange().getValues();
  var cfg = {};
  for (var k in DEFAULT_CONFIG) cfg[k] = DEFAULT_CONFIG[k];
  for (var i = 1; i < data.length; i++) {
    var key = String(data[i][0] || '').trim();
    if (key) {
      cfg[key] = String(data[i][1] || '').trim();
    }
  }
  return cfg;
}

function logAudit_(action, certId, user, details, clientInfo) {
  try {
    var sheet = ensureSheet_(SHEET_LOGS);
    sheet.appendRow([
      new Date().toISOString(),
      action || '',
      certId || '',
      user || 'Anonymous',
      details || '',
      clientInfo || ''
    ]);
  } catch (err) {
    console.error('Audit log error:', err);
  }
}

function jsonResponse_(payload, status) {
  var output = ContentService.createTextOutput(JSON.stringify(payload));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}

/**
 * HTTP GET Handler
 */
function doGet(e) {
  try {
    ensureSystemSheets_();
    var params = (e && e.parameter) || {};
    var action = (params.action || '').trim();
    var id = (params.id || '').trim();

    // 1. Connection Test Ping
    if (action === 'test' || params._test === 'true') {
      return jsonResponse_({
        success: true,
        message: 'GCS Certificate Portal Backend is online and active.',
        timestamp: new Date().toISOString()
      });
    }

    // 2. Fetch System Config (Header branding, prefix URL, etc.)
    if (action === 'getConfig') {
      return jsonResponse_({
        success: true,
        config: loadConfig_()
      });
    }

    // 3. Public Verification Lookup
    if (id || action === 'verify') {
      return jsonResponse_(handleVerifyLookup_(id, params));
    }

    // 4. Staff: List Certificates by Year
    if (action === 'listCertificates') {
      var year = params.year || String(new Date().getFullYear());
      return jsonResponse_(handleListCertificates_(year));
    }

    // 5. Staff: Search across Years
    if (action === 'search') {
      var q = (params.q || '').trim();
      return jsonResponse_(handleSearch_(q));
    }

    // 6. Super Admin: List Users
    if (action === 'getUsers') {
      return jsonResponse_(handleGetUsers_());
    }

    // 7. Super Admin: Get Audit Logs
    if (action === 'getLogs') {
      return jsonResponse_(handleGetLogs_());
    }

    // 8. Dual Mode (GET) mutations for maximum browser & CORS compatibility
    if (action === 'issueCertificate' && params.payload) {
      try {
        var payloadObj = JSON.parse(params.payload);
        return jsonResponse_(handleIssueSingle_({ certificate: payloadObj }));
      } catch (e) {
        return jsonResponse_({ success: false, error: 'Invalid payload: ' + e.message });
      }
    }
    if (action === 'batchIssue' && params.payload) {
      try {
        var batchObj = JSON.parse(params.payload);
        return jsonResponse_(handleBatchIssue_({ certificates: batchObj }));
      } catch (e) {
        return jsonResponse_({ success: false, error: 'Invalid batch payload: ' + e.message });
      }
    }
    if (action === 'updateStatus' && params.id && params.status) {
      return jsonResponse_(handleUpdateStatus_(params));
    }

    // 9. Super Admin: Delete Certificate (GET fallback)
    if (action === 'deleteCertificate' && params.id) {
      return jsonResponse_(handleDeleteCertificate_({ id: params.id, user: params.user || 'Admin' }));
    }

    // Default response
    return jsonResponse_({
      success: true,
      service: 'GCS Certificate Verification & Issuance Portal Backend',
      status: 'Ready'
    });
  } catch (err) {
    return jsonResponse_({ success: false, error: err.message }, 500);
  }
}

/**
 * Handle Verification Lookup by Certificate ID
 */
function handleVerifyLookup_(id, params) {
  if (!id || id.length < 3) {
    return { found: false, error: 'No valid Certificate ID provided.' };
  }

  // Routing prefix: First 2 characters denote year, e.g. "26" -> "2026"
  var yearPrefix = id.substring(0, 2);
  var primarySheetName = '20' + yearPrefix;
  var ss = getSpreadsheet_();

  var sheetsToSearch = [];
  var primarySheet = ss.getSheetByName(primarySheetName);
  if (primarySheet) sheetsToSearch.push(primarySheet);

  var allSheets = ss.getSheets();
  for (var s = 0; s < allSheets.length; s++) {
    var sh = allSheets[s];
    var sName = sh.getName();
    if (/^20\d{2}$/.test(sName) && (!primarySheet || sName !== primarySheetName)) {
      sheetsToSearch.push(sh);
    }
  }

  if (sheetsToSearch.length === 0) {
    return {
      found: false,
      error: 'No certificate registry sheet found.'
    };
  }

  for (var si = 0; si < sheetsToSearch.length; si++) {
    var sheet = sheetsToSearch[si];
    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) continue;

    var h = data[0].map(function (c) { return String(c || '').trim(); });
    var nameI = h.indexOf('RecipientName');
    if (nameI === -1) nameI = h.indexOf('Name');
    var dateI = h.indexOf('DateIssued');
    if (dateI === -1) dateI = h.indexOf('Date');

    var idx = {
      id: h.indexOf('ID'),
      name: nameI,
      type: h.indexOf('CertificateType'),
      date: dateI,
      by: h.indexOf('IssuedBy'),
      ref: h.indexOf('ReferenceNo'),
      desc: h.indexOf('Description'),
      table: h.indexOf('TableData'),
      status: h.indexOf('Status'),
      user: h.indexOf('IssuedByUser'),
      created: h.indexOf('CreatedAt'),
      scanCount: h.indexOf('ScanCount'),
      lastScan: h.indexOf('LastScannedAt')
    };

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (String(row[idx.id] || '').trim().toUpperCase() === id.toUpperCase()) {
        var currentScanCount = Number(row[idx.scanCount] || 0) + 1;
        var nowStr = new Date().toISOString();

        // Update scan count and last scanned timestamp in-place
        if (idx.scanCount !== -1) {
          sheet.getRange(i + 1, idx.scanCount + 1).setValue(currentScanCount);
        }
        if (idx.lastScan !== -1) {
          sheet.getRange(i + 1, idx.lastScan + 1).setValue(nowStr);
        }

        // Log audit
        logAudit_('VERIFY_SCAN', id, 'Public Verifier', 'Scanned via QR', params.clientInfo || '');

        var rawDate = row[idx.date];
        var formattedDate = rawDate instanceof Date
          ? Utilities.formatDate(rawDate, Session.getScriptTimeZone(), 'dd MMMM yyyy')
          : String(rawDate || '').trim();

        var statusRaw = String(row[idx.status] || 'Valid').trim();
        var normalizedStatus = ['invalid', 'revoked', 'not valid'].indexOf(statusRaw.toLowerCase()) !== -1 ? 'Revoked' : 'Valid';

        var cfg = loadConfig_();

        return {
          found: true,
          id: String(row[idx.id] || '').trim(),
          recipientName: String(row[idx.name] || '').trim(),
          name: String(row[idx.name] || '').trim(),
          certificateType: String(row[idx.type] || '').trim(),
          dateIssued: formattedDate,
          issuedBy: String(row[idx.by] || '').trim(),
          referenceNo: String(row[idx.ref] || '').trim(),
          description: String(row[idx.desc] || '').trim(),
          tableData: String(row[idx.table] || '').trim(),
          status: normalizedStatus,
          scanCount: currentScanCount,
          lastScannedAt: nowStr,
          branding: {
            headerBranding: cfg.HEADER_BRANDING || DEFAULT_CONFIG.HEADER_BRANDING || 'GCS Foundation',
            subBranding: cfg.SUB_BRANDING || DEFAULT_CONFIG.SUB_BRANDING || 'Certificate Verification Portal',
            contactEmail: cfg.CONTACT_EMAIL || DEFAULT_CONFIG.CONTACT_EMAIL || 'info@gcsmc.org'
          }
        };
      }
    }
  }

  return { found: false, error: 'Certificate ID not found in official registry.' };
}

/**
 * Staff: List Certificates by Year Tab
 */
function handleListCertificates_(year) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(year);
  if (!sheet) {
    return { success: true, year: year, certificates: [] };
  }

  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) {
    return { success: true, year: year, certificates: [] };
  }

  var h = data[0].map(function (c) { return String(c || '').trim(); });
  var results = [];

  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    if (!r[0]) continue;
    var rawDate = r[3];
    var formattedDate = rawDate instanceof Date
      ? Utilities.formatDate(rawDate, Session.getScriptTimeZone(), 'dd MMMM yyyy')
      : String(rawDate || '').trim();

    results.push({
      id: String(r[0] || '').trim(),
      recipientName: String(r[1] || '').trim(),
      certificateType: String(r[2] || '').trim(),
      dateIssued: formattedDate,
      issuedBy: String(r[4] || '').trim(),
      referenceNo: String(r[5] || '').trim(),
      description: String(r[6] || '').trim(),
      tableData: String(r[7] || '').trim(),
      status: String(r[8] || 'Valid').trim(),
      issuedByUser: String(r[9] || '').trim(),
      createdAt: String(r[10] || '').trim(),
      scanCount: Number(r[11] || 0),
      lastScannedAt: String(r[12] || '').trim()
    });
  }

  return { success: true, year: year, certificates: results };
}

/**
 * Staff: Search Certificate by ID or Recipient Name
 */
function handleSearch_(query) {
  if (!query) return { success: true, results: [] };
  var q = query.toLowerCase();
  var ss = getSpreadsheet_();
  var sheets = ss.getSheets();
  var results = [];

  for (var s = 0; s < sheets.length; s++) {
    var sheet = sheets[s];
    var name = sheet.getName();
    // Only search yearly tabs e.g. "2026", "2027"
    if (!/^20\d{2}$/.test(name)) continue;

    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      var r = data[i];
      var idStr = String(r[0] || '').toLowerCase();
      var nameStr = String(r[1] || '').toLowerCase();
      var refStr = String(r[5] || '').toLowerCase();

      if (idStr.indexOf(q) !== -1 || nameStr.indexOf(q) !== -1 || refStr.indexOf(q) !== -1) {
        results.push({
          id: String(r[0] || '').trim(),
          recipientName: String(r[1] || '').trim(),
          certificateType: String(r[2] || '').trim(),
          dateIssued: String(r[3] || '').trim(),
          issuedBy: String(r[4] || '').trim(),
          referenceNo: String(r[5] || '').trim(),
          description: String(r[6] || '').trim(),
          tableData: String(r[7] || '').trim(),
          status: String(r[8] || 'Valid').trim(),
          scanCount: Number(r[11] || 0),
          year: name
        });
      }
    }
  }

  return { success: true, results: results };
}

function handleGetUsers_() {
  var sheet = ensureSheet_(SHEET_USERS);
  var data = sheet.getDataRange().getValues();
  var users = [];
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    if (!r[0]) continue;
    users.push({
      user_id: String(r[0] || ''),
      name: String(r[1] || ''),
      designation: String(r[2] || ''),
      login_id: String(r[3] || ''),
      role: String(r[5] || 'USER'),
      active: String(r[6] || '').toUpperCase() === 'TRUE',
      created_at: String(r[7] || ''),
      updated_at: String(r[8] || '')
    });
  }
  return { success: true, users: users };
}

function handleGetLogs_() {
  var sheet = ensureSheet_(SHEET_LOGS);
  var data = sheet.getDataRange().getValues();
  var logs = [];
  var start = Math.max(1, data.length - 100);
  for (var i = data.length - 1; i >= start; i--) {
    var r = data[i];
    if (!r[0]) continue;
    logs.push({
      timestamp: String(r[0] || ''),
      action: String(r[1] || ''),
      certId: String(r[2] || ''),
      user: String(r[3] || ''),
      details: String(r[4] || ''),
      clientInfo: String(r[5] || '')
    });
  }
  return { success: true, logs: logs };
}

/**
 * HTTP POST Handler
 */
function doPost(e) {
  try {
    ensureSystemSheets_();
    var body = {};
    if (e && e.postData && e.postData.contents) {
      try {
        body = JSON.parse(e.postData.contents);
      } catch (pe) {
        body = {};
      }
    }
    var params = (e && e.parameter) || {};
    var action = (body.action || params.action || '').trim();

    // 1. Staff Authentication
    if (action === 'login') {
      return jsonResponse_(handleLoginPost_(body));
    }

    // 2. Issue Single Certificate
    if (action === 'issueCertificate') {
      return jsonResponse_(handleIssueSingle_(body));
    }

    // 3. Batch Issue Certificates (150+ records)
    if (action === 'batchIssue') {
      return jsonResponse_(handleBatchIssue_(body));
    }

    // 4. Update Status (Revoke / Reinstate)
    if (action === 'updateStatus') {
      return jsonResponse_(handleUpdateStatus_(body));
    }

    // 5. Update Certificate Content
    if (action === 'updateCertificate') {
      return jsonResponse_(handleUpdateCertificate_(body));
    }

    // 6. Super Admin: Save Config
    if (action === 'saveConfig') {
      return jsonResponse_(handleSaveConfig_(body));
    }

    // 7. Super Admin: Manage User
    if (action === 'saveUser') {
      return jsonResponse_(handleSaveUser_(body));
    }

    // 8. Super Admin: Delete Certificate
    if (action === 'deleteCertificate') {
      return jsonResponse_(handleDeleteCertificate_(body));
    }

    return jsonResponse_({ success: false, error: 'Unknown action: ' + action }, 400);
  } catch (err) {
    return jsonResponse_({ success: false, error: err.message }, 500);
  }
}

/**
 * Authenticate User
 */
function handleLoginPost_(body) {
  var username = String(body.username || body.login_id || '').trim().toLowerCase();
  var password = String(body.password || '').trim();

  if (!username || !password) {
    return { success: false, error: 'Username and password are required.' };
  }

  // Check code-level Super Admin
  if (username === DEFAULT_SUPER_ADMIN.login_id.toLowerCase() && password === DEFAULT_SUPER_ADMIN.password_hash) {
    logAudit_('LOGIN', '', DEFAULT_SUPER_ADMIN.name, 'Super Admin logged in', '');
    return {
      success: true,
      token: 'sess-superadmin-' + Date.now(),
      user: {
        user_id: DEFAULT_SUPER_ADMIN.user_id,
        name: DEFAULT_SUPER_ADMIN.name,
        designation: DEFAULT_SUPER_ADMIN.designation,
        login_id: DEFAULT_SUPER_ADMIN.login_id,
        role: DEFAULT_SUPER_ADMIN.role
      }
    };
  }

  var sheet = ensureSheet_(SHEET_USERS);
  var data = sheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    var uLogin = String(r[3] || '').trim().toLowerCase();
    var uPass = String(r[4] || '').trim();
    var uActive = String(r[6] || '').trim().toUpperCase() === 'TRUE';

    if (uLogin === username) {
      if (!uActive) {
        return { success: false, error: 'This user account has been deactivated. Contact Super Admin.' };
      }
      if (uPass === password) {
        var userObj = {
          user_id: String(r[0] || ''),
          name: String(r[1] || ''),
          designation: String(r[2] || ''),
          login_id: String(r[3] || ''),
          role: String(r[5] || 'USER')
        };
        logAudit_('LOGIN', '', userObj.name, 'Staff logged in successfully', '');
        return {
          success: true,
          token: 'sess-' + userObj.user_id + '-' + Date.now(),
          user: userObj
        };
      } else {
        return { success: false, error: 'Incorrect password.' };
      }
    }
  }

  return { success: false, error: 'User not found.' };
}

/**
 * Issue Single Certificate
 */
function handleIssueSingle_(body) {
  var cert = body.certificate || body;
  var id = String(cert.id || '').trim();
  if (!id || id.length < 3) {
    return { success: false, error: 'Invalid Certificate ID.' };
  }

  var yearPrefix = id.substring(0, 2);
  var sheetName = '20' + yearPrefix;
  var sheet = ensureSheet_(sheetName, CERT_HEADERS);

  // Check duplicate ID
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0] || '').trim().toUpperCase() === id.toUpperCase()) {
      return { success: false, error: 'Certificate ID ' + id + ' already exists in registry.' };
    }
  }

  var now = new Date().toISOString();
  var row = [
    id,
    cert.recipientName || '',
    cert.certificateType || '',
    cert.dateIssued || '',
    cert.issuedBy || '',
    cert.referenceNo || '',
    cert.description || '',
    cert.tableData || '',
    cert.status || 'Valid',
    cert.issuedByUser || 'Staff',
    now,
    0,
    ''
  ];

  sheet.appendRow(row);
  logAudit_('ISSUE_SINGLE', id, cert.issuedByUser || 'Staff', 'Issued certificate for ' + cert.recipientName, '');

  return { success: true, id: id, message: 'Certificate issued successfully.' };
}

/**
 * Batch Issue Certificates (Efficient Single-Range Multi-Row setValues)
 */
function handleBatchIssue_(body) {
  var certificates = body.certificates || [];
  if (!certificates || certificates.length === 0) {
    return { success: false, error: 'No certificates provided for batch issue.' };
  }

  var byYear = {};
  var now = new Date().toISOString();
  var currentUser = body.issuedByUser || 'Staff';

  for (var i = 0; i < certificates.length; i++) {
    var c = certificates[i];
    var id = String(c.id || '').trim();
    if (!id || id.length < 3) continue;

    var year = '20' + id.substring(0, 2);
    if (!byYear[year]) byYear[year] = [];

    byYear[year].push([
      id,
      c.recipientName || '',
      c.certificateType || '',
      c.dateIssued || '',
      c.issuedBy || '',
      c.referenceNo || '',
      c.description || '',
      c.tableData || '',
      c.status || 'Valid',
      currentUser,
      now,
      0,
      ''
    ]);
  }

  var totalInserted = 0;

  for (var yr in byYear) {
    var rows = byYear[yr];
    if (rows.length === 0) continue;

    var sheet = ensureSheet_(yr, CERT_HEADERS);
    var startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, rows.length, CERT_HEADERS.length).setValues(rows);
    totalInserted += rows.length;
  }

  logAudit_('BATCH_ISSUE', '', currentUser, 'Batch issued ' + totalInserted + ' certificates', '');
  return { success: true, count: totalInserted, message: 'Batch issue completed successfully.' };
}

/**
 * Update Certificate Status (Revoke / Reinstate)
 */
function handleUpdateStatus_(body) {
  var id = String(body.id || '').trim();
  var newStatus = String(body.status || 'Valid').trim();
  var user = String(body.user || 'Admin').trim();

  if (!id || id.length < 3) return { success: false, error: 'Invalid Certificate ID.' };

  var sheetName = '20' + id.substring(0, 2);
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return { success: false, error: 'Sheet ' + sheetName + ' not found.' };

  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0] || '').trim().toUpperCase() === id.toUpperCase()) {
      sheet.getRange(i + 1, 9).setValue(newStatus); // Status is column 9
      logAudit_('STATUS_CHANGE', id, user, 'Status changed to ' + newStatus, '');
      return { success: true, id: id, status: newStatus };
    }
  }

  return { success: false, error: 'Certificate ID not found.' };
}

/**
 * Edit Certificate Details
 */
function handleUpdateCertificate_(body) {
  var cert = body.certificate || body;
  var id = String(cert.id || '').trim();
  var user = String(body.user || 'Admin').trim();

  if (!id || id.length < 3) return { success: false, error: 'Invalid Certificate ID.' };

  var sheetName = '20' + id.substring(0, 2);
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return { success: false, error: 'Sheet ' + sheetName + ' not found.' };

  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0] || '').trim().toUpperCase() === id.toUpperCase()) {
      sheet.getRange(i + 1, 2).setValue(cert.recipientName || '');
      sheet.getRange(i + 1, 3).setValue(cert.certificateType || '');
      sheet.getRange(i + 1, 4).setValue(cert.dateIssued || '');
      sheet.getRange(i + 1, 5).setValue(cert.issuedBy || '');
      sheet.getRange(i + 1, 6).setValue(cert.referenceNo || '');
      sheet.getRange(i + 1, 7).setValue(cert.description || '');
      sheet.getRange(i + 1, 8).setValue(cert.tableData || '');
      logAudit_('EDIT_CERT', id, user, 'Updated certificate details', '');
      return { success: true, id: id, message: 'Certificate updated successfully.' };
    }
  }

  return { success: false, error: 'Certificate ID not found.' };
}

/**
 * Super Admin: Permanently Delete a Certificate Record
 */
function handleDeleteCertificate_(body) {
  var id = String(body.id || '').trim();
  var user = String(body.user || 'Super Admin').trim();

  if (!id || id.length < 3) return { success: false, error: 'Invalid Certificate ID.' };

  var sheetName = '20' + id.substring(0, 2);
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return { success: false, error: 'Sheet ' + sheetName + ' not found.' };

  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0] || '').trim().toUpperCase() === id.toUpperCase()) {
      sheet.deleteRow(i + 1); // Permanently removes the row
      logAudit_('DELETE_CERT', id, user, 'Certificate permanently deleted by Super Admin', '');
      return { success: true, id: id, message: 'Certificate permanently deleted from registry.' };
    }
  }

  return { success: false, error: 'Certificate ID not found.' };
}

/**
 * Super Admin: Save System Configuration
 */
function handleSaveConfig_(body) {
  var newConfig = body.config || {};
  var sheet = ensureSheet_(SHEET_CONFIG);
  var data = sheet.getDataRange().getValues();
  var now = new Date().toISOString();

  for (var k in newConfig) {
    var val = String(newConfig[k] || '').trim();
    var found = false;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0] || '').trim() === k) {
        sheet.getRange(i + 1, 2).setValue(val);
        sheet.getRange(i + 1, 3).setValue(now);
        found = true;
        break;
      }
    }
    if (!found) {
      sheet.appendRow([k, val, now]);
    }
  }

  logAudit_('CONFIG_CHANGE', '', body.user || 'Super Admin', 'Updated portal configuration', '');
  return { success: true, config: loadConfig_() };
}

/**
 * Super Admin: Create / Update User Account
 */
function handleSaveUser_(body) {
  var u = body.userData || {};
  var sheet = ensureSheet_(SHEET_USERS);
  var data = sheet.getDataRange().getValues();
  var now = new Date().toISOString();

  var userId = u.user_id || ('user-' + Date.now());
  var loginId = String(u.login_id || '').trim().toLowerCase();

  if (!loginId) return { success: false, error: 'Login ID is required.' };

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0] || '') === userId || String(data[i][3] || '').toLowerCase() === loginId) {
      sheet.getRange(i + 1, 2).setValue(u.name || '');
      sheet.getRange(i + 1, 3).setValue(u.designation || '');
      sheet.getRange(i + 1, 4).setValue(loginId);
      if (u.password) {
        sheet.getRange(i + 1, 5).setValue(u.password);
      }
      sheet.getRange(i + 1, 6).setValue(u.role || 'USER');
      sheet.getRange(i + 1, 7).setValue(u.active ? 'TRUE' : 'FALSE');
      sheet.getRange(i + 1, 9).setValue(now);

      logAudit_('USER_UPDATE', '', body.adminUser || 'Super Admin', 'Updated user ' + loginId, '');
      return { success: true, message: 'User updated successfully.' };
    }
  }

  // Create new user
  sheet.appendRow([
    userId,
    u.name || '',
    u.designation || '',
    loginId,
    u.password || 'Gcs@12345',
    u.role || 'USER',
    u.active ? 'TRUE' : 'FALSE',
    now,
    now
  ]);

  logAudit_('USER_CREATE', '', body.adminUser || 'Super Admin', 'Created user ' + loginId, '');
  return { success: true, message: 'User created successfully.' };
}
