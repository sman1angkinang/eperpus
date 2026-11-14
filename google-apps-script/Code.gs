const QRDESK_CONFIG = {
  spreadsheetId: "1JNrQEaX_ERqZ3kIm875JddkC9U6nJ1Yq110RXXWSFOk",
  qrSheetName: "Data QR",
  scanSheetName: "Riwayat Scan",
  apiKeyProperty: "QRDESK_API_KEY"
};

const QR_HEADERS = ["ID", "Nama QR", "Kategori", "Kode", "Dibuat (ISO)", "Status"];
const SCAN_HEADERS = ["ID Scan", "ID QR", "Nama QR", "Kode", "Waktu Scan (ISO)", "Sumber"];
const QR_SEED_ROWS = [
  ["1", "Website QR Desk", "Website", "QR-001", "2025-01-08T09:00:00.000Z", "aktif"],
  ["2", "Menu Kafe Senja", "Produk", "QR-002", "2025-01-10T09:00:00.000Z", "aktif"],
  ["3", "Tiket Event Kreatif", "Event", "QR-003", "2025-01-12T09:00:00.000Z", "aktif"],
  ["4", "Panduan Pengguna", "Dokumen", "QR-004", "2025-01-15T09:00:00.000Z", "aktif"],
  ["5", "Katalog Produk", "Produk", "QR-005", "2025-01-19T09:00:00.000Z", "aktif"]
];

function initializeQrDesk() {
  const spreadsheet = SpreadsheetApp.openById(QRDESK_CONFIG.spreadsheetId);
  const qrSheet = getOrCreateSheet_(spreadsheet, QRDESK_CONFIG.qrSheetName, QR_HEADERS);
  getOrCreateSheet_(spreadsheet, QRDESK_CONFIG.scanSheetName, SCAN_HEADERS);
  if (qrSheet.getLastRow() <= 1) {
    writeRows_(qrSheet, 2, QR_SEED_ROWS);
  }

  const properties = PropertiesService.getScriptProperties();
  let apiKey = properties.getProperty(QRDESK_CONFIG.apiKeyProperty);
  if (!apiKey) {
    apiKey = Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, "");
    properties.setProperty(QRDESK_CONFIG.apiKeyProperty, apiKey);
  }
  Logger.log("QR Desk API key (simpan privat): " + apiKey);
  Logger.log("Setup selesai. Deploy sebagai Web App untuk menghubungkan website.");
}

function rotateQrDeskApiKey() {
  const apiKey = Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, "");
  PropertiesService.getScriptProperties().setProperty(QRDESK_CONFIG.apiKeyProperty, apiKey);
  Logger.log("API key baru (simpan privat): " + apiKey);
}

function doGet(event) {
  const params = event && event.parameter ? event.parameter : {};
  const callback = params.callback || "";
  try {
    const expectedKey = PropertiesService.getScriptProperties().getProperty(QRDESK_CONFIG.apiKeyProperty);
    if (!expectedKey) throw new Error("API key belum dibuat. Jalankan initializeQrDesk pada project Apps Script ini.");
    if (!params.key) throw new Error("API key tidak dikirim. Masukkan key pada konfigurasi website.");
    if (params.key !== expectedKey) throw new Error("API key berbeda dari key project ini. Salin ulang key dari Apps Script yang sama dengan deployment.");

    const result = runAction_(params);
    result.ok = true;
    return response_(callback, result);
  } catch (error) {
    return response_(callback, { ok: false, error: error.message || "Permintaan gagal." });
  }
}

function runAction_(params) {
  const spreadsheet = SpreadsheetApp.openById(QRDESK_CONFIG.spreadsheetId);
  const qrSheet = spreadsheet.getSheetByName(QRDESK_CONFIG.qrSheetName);
  const scanSheet = spreadsheet.getSheetByName(QRDESK_CONFIG.scanSheetName);
  if (!qrSheet || !scanSheet) {
    throw new Error("Sheet belum disiapkan. Jalankan initializeQrDesk terlebih dahulu.");
  }

  switch (params.action) {
    case "load":
      return { qrs: readQrRows_(qrSheet), scans: readScanRows_(scanSheet) };
    case "upsertQr":
      return withLock_(function () {
        upsertQr_(qrSheet, parseRecord_(params.record, "QR"));
        return {};
      });
    case "deleteQr":
      return withLock_(function () {
        deleteById_(qrSheet, params.id);
        return {};
      });
    case "appendScan":
      return withLock_(function () {
        appendScan_(scanSheet, parseRecord_(params.record, "scan"));
        return {};
      });
    case "clearScans":
      return withLock_(function () {
        if (scanSheet.getLastRow() > 1) {
          scanSheet.getRange(2, 1, scanSheet.getLastRow() - 1, SCAN_HEADERS.length).clearContent();
        }
        return {};
      });
    default:
      throw new Error("Aksi tidak dikenal.");
  }
}

function getOrCreateSheet_(spreadsheet, name, headers) {
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(name);
  }
  if (sheet.getLastRow() === 0) {
    writeRows_(sheet, 1, [headers]);
  } else {
    const currentHeaders = sheet.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
    if (headers.some(function (header, index) { return currentHeaders[index] !== header; })) {
      throw new Error('Header sheet "' + name + '" tidak sesuai. Data tidak diubah.');
    }
  }
  return sheet;
}

function writeRows_(sheet, startRow, rows) {
  if (!rows.length) return;
  const range = sheet.getRange(startRow, 1, rows.length, rows[0].length);
  range.setNumberFormat("@");
  range.setValues(rows);
}

function parseRecord_(serialized, kind) {
  if (!serialized || serialized.length > 2000) {
    throw new Error("Data " + kind + " tidak valid.");
  }
  let record;
  try {
    record = JSON.parse(serialized);
  } catch (error) {
    throw new Error("Format data " + kind + " tidak valid.");
  }
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error("Data " + kind + " tidak valid.");
  }
  return record;
}

function upsertQr_(sheet, qr) {
  const row = [
    requiredText_(qr.id, "ID", 100),
    requiredText_(qr.name, "Nama QR", 80),
    requiredText_(qr.category, "Kategori", 50),
    requiredText_(qr.code, "Kode QR", 64),
    requiredText_(qr.createdAt, "Waktu dibuat", 40),
    qr.active === false ? "nonaktif" : "aktif"
  ];
  const existingRow = findRowById_(sheet, row[0]);
  writeRows_(sheet, existingRow || Math.max(sheet.getLastRow() + 1, 2), [row]);
}

function appendScan_(sheet, scan) {
  const id = requiredText_(scan.id, "ID scan", 100);
  if (findRowById_(sheet, id)) return;
  const row = [
    id,
    requiredText_(scan.qrId, "ID QR", 100),
    requiredText_(scan.label, "Nama QR", 80),
    requiredText_(scan.code, "Kode QR", 64),
    requiredText_(scan.scannedAt, "Waktu scan", 40),
    scan.source === "camera" ? "camera" : "manual"
  ];
  writeRows_(sheet, Math.max(sheet.getLastRow() + 1, 2), [row]);
}

function deleteById_(sheet, id) {
  const row = findRowById_(sheet, requiredText_(id, "ID", 100));
  if (row) sheet.deleteRow(row);
}

function findRowById_(sheet, id) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
  for (let index = 0; index < ids.length; index += 1) {
    if (ids[index][0] === id) return index + 2;
  }
  return 0;
}

function readQrRows_(sheet) {
  if (sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, QR_HEADERS.length).getValues()
    .filter(function (row) { return row[0]; })
    .map(function (row) {
      return {
        id: String(row[0]),
        name: String(row[1]),
        category: String(row[2]),
        code: String(row[3]),
        createdAt: isoString_(row[4]),
        active: String(row[5]).toLowerCase() !== "nonaktif"
      };
    });
}

function readScanRows_(sheet) {
  if (sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, SCAN_HEADERS.length).getValues()
    .filter(function (row) { return row[0]; })
    .map(function (row) {
      return {
        id: String(row[0]),
        qrId: String(row[1]),
        label: String(row[2]),
        code: String(row[3]),
        scannedAt: isoString_(row[4]),
        source: String(row[5]) === "camera" ? "camera" : "manual"
      };
    });
}

function isoString_(value) {
  return value instanceof Date ? value.toISOString() : String(value || "");
}

function requiredText_(value, label, maxLength) {
  const text = String(value == null ? "" : value).trim();
  if (!text || text.length > maxLength) {
    throw new Error(label + " kosong atau terlalu panjang.");
  }
  return text;
}

function withLock_(operation) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    return operation();
  } finally {
    lock.releaseLock();
  }
}

function response_(callback, payload) {
  if (callback && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(callback)) {
    const json = JSON.stringify(payload)
      .replace(/</g, "\\u003c")
      .replace(/>/g, "\\u003e")
      .replace(/&/g, "\\u0026")
      .replace(/\u2028/g, "\\u2028")
      .replace(/\u2029/g, "\\u2029");
    return ContentService.createTextOutput(callback + "(" + json + ");")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
