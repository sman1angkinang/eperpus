(() => {
  "use strict";

  const DB_KEY = "qrdesk.database.v1";
  const AUTH_KEY = "qrdesk.authenticated";
  const SHEETS_CONFIG_KEY = "qrdesk.sheets-config.v1";
  const SHEETS_OUTBOX_KEY = "qrdesk.sheets-outbox.v1";
  // Fill these before publishing; values embedded in GitHub Pages are public.
  const PUBLIC_SHEETS_CONFIG = {
    url: "https://script.google.com/macros/s/AKfycbzQVWDqMmnSvlr-_sP8GdIovBFC07wt1pDDU4R4EMAFnsRo03U9Hq9LUhZzj-fp3R9V/exec",
    apiKey: "ff333a7a0fd546ed87d5aeda403f6f410646c3e78a6849fb9cf52b7760b4fd2f"
  };
  const demoRecords = [
    { id: "1", name: "Website QR Desk", category: "Website", code: "QR-001", createdAt: "2025-01-08T09:00:00.000Z", active: true },
    { id: "2", name: "Menu Kafe Senja", category: "Produk", code: "QR-002", createdAt: "2025-01-10T09:00:00.000Z", active: true },
    { id: "3", name: "Tiket Event Kreatif", category: "Event", code: "QR-003", createdAt: "2025-01-12T09:00:00.000Z", active: true },
    { id: "4", name: "Panduan Pengguna", category: "Dokumen", code: "QR-004", createdAt: "2025-01-15T09:00:00.000Z", active: true },
    { id: "5", name: "Katalog Produk", category: "Produk", code: "QR-005", createdAt: "2025-01-19T09:00:00.000Z", active: true }
  ];

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const loginScreen = $("#login-screen");
  const appShell = $("#app-shell");
  const toast = $("#toast");
  let database = loadDatabase();
  let scanner = null;
  let toastTimer;
  let scanLocked = false;
  let sheetConfig = loadSheetConfig();
  let sheetSyncing = false;
  let sheetOutboxTask = null;
  let sheetRetryTimer = null;
  let scanAudioContext = null;
  let scanAudioUnavailable = false;

  function loadDatabase() {
    try {
      const saved = localStorage.getItem(DB_KEY);
      if (!saved) {
        const seeded = { qrs: demoRecords, scans: [] };
        localStorage.setItem(DB_KEY, JSON.stringify(seeded));
        return seeded;
      }
      const parsed = JSON.parse(saved);
      if (!parsed || !Array.isArray(parsed.qrs) || !Array.isArray(parsed.scans)) {
        throw new Error("Format database lokal tidak valid.");
      }
      return parsed;
    } catch (error) {
      console.error("Gagal membaca database lokal:", error);
      return { qrs: demoRecords, scans: [] };
    }
  }

  function saveDatabase() {
    try {
      localStorage.setItem(DB_KEY, JSON.stringify(database));
    } catch (error) {
      console.error("Gagal menyimpan database lokal:", error);
      showToast("Data gagal disimpan. Periksa ruang penyimpanan browser.");
      return false;
    }
    return true;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);
  }

  function formatDate(value, options) {
    return new Intl.DateTimeFormat("id-ID", options || { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
  }

  function formatDateTime(value) {
    return new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 3000);
  }

  function loadSheetConfig() {
    try {
      const publicUrl = new URL(PUBLIC_SHEETS_CONFIG.url);
      if (
        publicUrl.protocol === "https:"
        && publicUrl.hostname === "script.google.com"
        && /^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(publicUrl.pathname)
        && /^[a-f0-9]{64}$/i.test(PUBLIC_SHEETS_CONFIG.apiKey)
      ) {
        return {
          url: publicUrl.toString(),
          apiKey: PUBLIC_SHEETS_CONFIG.apiKey,
          initialized: true
        };
      }
    } catch (error) {
      if (PUBLIC_SHEETS_CONFIG.url) console.error("Konfigurasi publik Google Sheets tidak valid:", error);
    }
    try {
      const saved = localStorage.getItem(SHEETS_CONFIG_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch (error) {
      console.error("Gagal membaca konfigurasi Google Sheets:", error);
      return null;
    }
  }

  function saveSheetConfig() {
    try {
      localStorage.setItem(SHEETS_CONFIG_KEY, JSON.stringify(sheetConfig));
      return true;
    } catch (error) {
      console.error("Gagal menyimpan konfigurasi Google Sheets:", error);
      showToast("Konfigurasi gagal disimpan di browser ini.");
      return false;
    }
  }

  function setSheetStatus(label, state) {
    $("#sheet-status-label").textContent = label;
    $("#sheet-settings-button").dataset.state = state;
    $("#storage-label").textContent = state === "connected" ? "Google Sheets" : state === "syncing" ? "Sinkronisasi Sheets" : "Penyimpanan lokal";
    $("#storage-description").textContent = state === "connected" ? "Database tersinkron otomatis" : state === "error" ? "Perlu pemeriksaan koneksi" : "Data tersimpan di browser ini";
  }

  function readSheetOutbox() {
    try {
      const saved = localStorage.getItem(SHEETS_OUTBOX_KEY);
      const pending = saved ? JSON.parse(saved) : [];
      return Array.isArray(pending) ? pending : [];
    } catch (error) {
      console.error("Gagal membaca antrean sinkronisasi:", error);
      throw new Error("Antrean sinkronisasi lokal tidak dapat dibaca.");
    }
  }

  function saveSheetOutbox(pending) {
    try {
      localStorage.setItem(SHEETS_OUTBOX_KEY, JSON.stringify(pending));
    } catch (error) {
      console.error("Gagal menyimpan antrean sinkronisasi:", error);
      throw new Error("Perubahan belum dapat dimasukkan ke antrean sinkronisasi lokal.");
    }
  }

  function requestSheet(action, payload) {
    if (!sheetConfig) return Promise.reject(new Error("Google Sheets belum dikonfigurasi."));
    const callbackName = `qrdesk_jsonp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const url = new URL(sheetConfig.url);
    url.search = "";
    url.hash = "";
    url.searchParams.set("action", action);
    url.searchParams.set("key", sheetConfig.apiKey);
    url.searchParams.set("callback", callbackName);
    if (payload && payload.record) url.searchParams.set("record", JSON.stringify(payload.record));
    if (payload && payload.id) url.searchParams.set("id", payload.id);

    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      let timeout;
      const cleanup = () => {
        clearTimeout(timeout);
        delete window[callbackName];
        script.remove();
      };
      window[callbackName] = (result) => {
        cleanup();
        if (!result || result.ok !== true) {
          reject(new Error(result && result.error ? result.error : "Google Sheets menolak permintaan."));
          return;
        }
        resolve(result);
      };
      script.onerror = () => {
        cleanup();
        reject(new Error("Tidak dapat menghubungi Apps Script. Periksa URL, deployment, koneksi, dan API key."));
      };
      timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Google Sheets tidak merespons. Coba lagi beberapa saat."));
      }, 20000);
      script.async = true;
      script.referrerPolicy = "no-referrer";
      script.src = url.toString();
      document.head.appendChild(script);
    });
  }

  function queueSheetMutation(action, payload) {
    let pending;
    try {
      pending = readSheetOutbox();
      pending.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        action,
        payload
      });
      saveSheetOutbox(pending);
    } catch (error) {
      setSheetStatus("Sinkronisasi gagal", "error");
      showToast(error.message);
      return Promise.resolve(false);
    }
    if (!sheetConfig) {
      setSheetStatus("Data lokal saja", "");
      return Promise.resolve(false);
    }
    if (sheetSyncing) return Promise.resolve(false);
    return flushSheetOutbox().then(() => true).catch((error) => {
      console.error("Sinkronisasi Google Sheets tertunda:", error);
      setSheetStatus("Sinkronisasi tertunda", "error");
      showToast(`Data lokal tersimpan; sinkronisasi Sheets tertunda: ${error.message}`);
      return false;
    });
  }

  function flushSheetOutbox() {
    if (!sheetConfig) return Promise.resolve();
    if (sheetOutboxTask) return sheetOutboxTask;
    const task = (async () => {
      setSheetStatus("Menyinkronkan...", "syncing");
      while (true) {
        const pending = readSheetOutbox();
        if (!pending.length) break;
        const item = pending[0];
        await requestSheet(item.action, item.payload);
        const current = readSheetOutbox().filter((entry) => entry.id !== item.id);
        saveSheetOutbox(current);
      }
      clearTimeout(sheetRetryTimer);
      sheetRetryTimer = null;
      setSheetStatus("Google Sheets terhubung", "connected");
    })().catch((error) => {
      setSheetStatus("Sinkronisasi tertunda", "error");
      clearTimeout(sheetRetryTimer);
      sheetRetryTimer = setTimeout(() => {
        flushSheetOutbox().catch((retryError) => console.error("Percobaan ulang sinkronisasi gagal:", retryError));
      }, 15000);
      throw error;
    });
    sheetOutboxTask = task.finally(() => {
      sheetOutboxTask = null;
    });
    return sheetOutboxTask;
  }

  async function synchronizeSpreadsheet(importLocalData) {
    if (!sheetConfig) return;
    if (sheetSyncing) throw new Error("Sinkronisasi Google Sheets sedang berjalan. Coba lagi setelah selesai.");
    sheetSyncing = true;
    setSheetStatus("Menyinkronkan...", "syncing");
    try {
      await flushSheetOutbox();
      setSheetStatus("Menyinkronkan...", "syncing");
      let remote = await requestSheet("load");
      if (importLocalData) {
        const remoteQrIds = new Set(remote.qrs.map((qr) => qr.id));
        const remoteScanIds = new Set(remote.scans.map((scan) => scan.id));
        const pending = readSheetOutbox();
        const onlySeedQrs = database.qrs.length === demoRecords.length
          && database.qrs.every((qr, index) => qr.id === demoRecords[index].id && qr.createdAt === demoRecords[index].createdAt)
          && database.scans.length === 0;
        if (!onlySeedQrs) {
          database.qrs.filter((qr) => !remoteQrIds.has(qr.id)).forEach((qr) => {
            pending.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, action: "upsertQr", payload: { record: qr } });
          });
        }
        database.scans.filter((scan) => !remoteScanIds.has(scan.id)).forEach((scan) => {
          pending.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, action: "appendScan", payload: { record: scan } });
        });
        saveSheetOutbox(pending);
        await flushSheetOutbox();
        remote = await requestSheet("load");
      }
      if (!Array.isArray(remote.qrs) || !Array.isArray(remote.scans)) {
        throw new Error("Format data yang diterima dari spreadsheet tidak valid.");
      }
      database = { qrs: remote.qrs, scans: remote.scans };
      if (!saveDatabase()) throw new Error("Data spreadsheet gagal disimpan ke browser.");
      sheetConfig.initialized = true;
      if (!saveSheetConfig()) throw new Error("Status koneksi gagal disimpan di browser.");
      const hadConcurrentChanges = readSheetOutbox().length > 0;
      if (hadConcurrentChanges) {
        await flushSheetOutbox();
        remote = await requestSheet("load");
        database = { qrs: remote.qrs, scans: remote.scans };
        if (!saveDatabase()) throw new Error("Data spreadsheet gagal disimpan ke browser.");
      }
      render();
      setSheetStatus("Google Sheets terhubung", "connected");
    } catch (error) {
      console.error("Sinkronisasi Google Sheets gagal:", error);
      setSheetStatus("Sinkronisasi gagal", "error");
      throw error;
    } finally {
      sheetSyncing = false;
    }
  }

  function syncMutation(action, payload) {
    queueSheetMutation(action, payload);
  }

  function prepareScanAudio() {
    const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextConstructor) {
      scanAudioUnavailable = true;
      return;
    }
    try {
      if (!scanAudioContext) scanAudioContext = new AudioContextConstructor();
      if (scanAudioContext.state === "suspended") {
        scanAudioContext.resume().catch((error) => {
          console.error("Audio context tidak dapat diaktifkan:", error);
          scanAudioUnavailable = true;
        });
      }
    } catch (error) {
      console.error("Audio context tidak dapat dibuat:", error);
      scanAudioUnavailable = true;
    }
  }

  function playScanSound() {
    if (scanAudioUnavailable || !scanAudioContext) {
      showToast("Scan berhasil dicatat, tetapi suara tidak tersedia di browser ini.");
      return;
    }

    const playTone = () => {
      try {
        const now = scanAudioContext.currentTime;
        const oscillator = scanAudioContext.createOscillator();
        const gain = scanAudioContext.createGain();
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(880, now);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.16, now + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
        oscillator.connect(gain);
        gain.connect(scanAudioContext.destination);
        oscillator.onended = () => {
          oscillator.disconnect();
          gain.disconnect();
        };
        oscillator.start(now);
        oscillator.stop(now + 0.16);
      } catch (error) {
        console.error("Bunyi scan gagal diputar:", error);
        showToast("Scan berhasil dicatat, tetapi bunyi konfirmasi gagal diputar.");
      }
    };

    if (scanAudioContext.state === "running") {
      playTone();
    } else {
      scanAudioContext.resume().then(playTone).catch((error) => {
        console.error("Audio context tidak dapat dilanjutkan:", error);
        showToast("Scan berhasil dicatat, tetapi browser memblokir bunyi konfirmasi.");
      });
    }
  }

  function setAuthenticated(authenticated) {
    loginScreen.classList.toggle("is-hidden", authenticated);
    appShell.classList.toggle("is-hidden", !authenticated);
    if (authenticated) {
      render();
      if (sheetConfig) synchronizeSpreadsheet(sheetConfig.initialized !== true).catch((error) => showToast(`Sinkronisasi Google Sheets gagal: ${error.message}`));
    }
  }

  $("#login-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const username = $("#username").value.trim();
    const password = $("#password").value;
    if (username !== "admin" || password !== "qrcode123") {
      $("#login-error").textContent = "Nama pengguna atau kata sandi tidak sesuai.";
      return;
    }
    $("#login-error").textContent = "";
    sessionStorage.setItem(AUTH_KEY, "true");
    setAuthenticated(true);
  });

  $("#logout-button").addEventListener("click", () => {
    stopScanner();
    sessionStorage.removeItem(AUTH_KEY);
    setAuthenticated(false);
    $("#password").value = "";
  });

  function navigate(view) {
    const titles = { overview: "Ringkasan", codes: "Data QR", scanner: "Scanner", history: "Riwayat scan" };
    $$(".page-view").forEach((section) => section.classList.toggle("is-hidden", section.id !== `view-${view}`));
    $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
    $("#page-title").textContent = titles[view] || titles.overview;
    $("#sidebar").classList.remove("menu-open");
    if (view !== "scanner") stopScanner();
    if (view === "scanner") renderLastScan();
  }

  $$(".nav-item").forEach((item) => item.addEventListener("click", () => navigate(item.dataset.view)));
  $$("[data-navigate]").forEach((item) => item.addEventListener("click", () => navigate(item.dataset.navigate)));
  $("#mobile-menu").addEventListener("click", () => $("#sidebar").classList.toggle("menu-open"));
  $("#today-label").textContent = new Intl.DateTimeFormat("id-ID", { weekday: "short", day: "numeric", month: "short" }).format(new Date());

  function render() {
    renderStats();
    renderQrList();
    renderHistory();
    renderRecentScans();
    renderLastScan();
  }

  function renderStats() {
    const today = new Date().toDateString();
    $("#stat-qr").textContent = database.qrs.length;
    $("#stat-scans").textContent = database.scans.length;
    $("#stat-today").textContent = database.scans.filter((scan) => new Date(scan.scannedAt).toDateString() === today).length;
    $("#stat-active").textContent = database.qrs.filter((qr) => qr.active).length;
    $("#nav-qr-count").textContent = database.qrs.length;
    $("#today-stat-caption").textContent = formatDate(new Date(), { day: "numeric", month: "long", year: "numeric" });
  }

  function qrRow(qr) {
    return `<tr><td><span class="qr-name"><button class="qr-thumb" data-qr-preview="${escapeHtml(qr.id)}" data-qr-value="${escapeHtml(qr.code)}" aria-label="Pratinjau QR ${escapeHtml(qr.code)}"></button>${escapeHtml(qr.name)}</span></td><td><span class="code-label">${escapeHtml(qr.code)}</span></td><td>${escapeHtml(qr.category)}</td><td>${formatDate(qr.createdAt)}</td><td><span class="status-pill">Aktif</span></td><td><button class="row-action" data-delete-qr="${escapeHtml(qr.id)}" aria-label="Hapus ${escapeHtml(qr.name)}">×</button></td></tr>`;
  }

  function renderQrList() {
    const query = $("#qr-search").value.trim().toLowerCase();
    const qrs = database.qrs.filter((qr) => `${qr.name} ${qr.code} ${qr.category}`.toLowerCase().includes(query));
    $("#qr-list").innerHTML = qrs.map(qrRow).join("");
    $("#codes-count").textContent = database.qrs.length;
    $("#qr-empty").classList.toggle("is-hidden", qrs.length > 0);
    $("#qr-list").classList.toggle("is-hidden", qrs.length === 0);
    if (window.QRCode) {
      $$(".qr-thumb").forEach((element) => {
        new QRCode(element, {
          text: element.dataset.qrValue,
          width: 40,
          height: 40,
          colorDark: "#292743",
          colorLight: "#ffffff",
          correctLevel: QRCode.CorrectLevel.M
        });
      });
    } else if (qrs.length) {
      console.error("Library pembuat QR belum tersedia.");
    }
    $$("[data-delete-qr]").forEach((button) => button.addEventListener("click", () => deleteQr(button.dataset.deleteQr)));
  }

  $("#qr-list").addEventListener("click", (event) => {
    const previewButton = event.target.closest("[data-qr-preview]");
    if (!previewButton) return;
    const qr = database.qrs.find((item) => item.id === previewButton.dataset.qrPreview);
    if (!qr) return;
    if (!window.QRCode) {
      showToast("Library pembuat QR belum tersedia. Periksa koneksi internet.");
      return;
    }
    $("#qr-preview-title").textContent = qr.name;
    $("#qr-preview-code").textContent = qr.code;
    $("#qr-preview-image").replaceChildren();
    new QRCode($("#qr-preview-image"), {
      text: qr.code,
      width: 220,
      height: 220,
      colorDark: "#292743",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.M
    });
    $("#qr-preview-modal").classList.remove("is-hidden");
  });

  function closeQrPreview() {
    $("#qr-preview-modal").classList.add("is-hidden");
  }
  $("#close-qr-preview").addEventListener("click", closeQrPreview);
  $("#qr-preview-modal").addEventListener("click", (event) => { if (event.target.id === "qr-preview-modal") closeQrPreview(); });
  $("#download-qr").addEventListener("click", () => {
    const canvas = $("#qr-preview-image canvas");
    if (!canvas) {
      showToast("Gambar QR belum siap diunduh.");
      return;
    }
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = `${$("#qr-preview-code").textContent}.png`;
    link.click();
  });

  const sheetSettingsModal = $("#sheet-settings-modal");
  function openSheetSettings() {
    $("#sheet-url").value = sheetConfig ? sheetConfig.url : "";
    $("#sheet-api-key").value = sheetConfig ? sheetConfig.apiKey : "";
    $("#sheet-config-error").textContent = "";
    sheetSettingsModal.classList.remove("is-hidden");
  }
  function closeSheetSettings() {
    sheetSettingsModal.classList.add("is-hidden");
  }
  $("#sheet-settings-button").addEventListener("click", openSheetSettings);
  $("#close-sheet-settings").addEventListener("click", closeSheetSettings);
  sheetSettingsModal.addEventListener("click", (event) => {
    if (event.target === sheetSettingsModal) closeSheetSettings();
  });
  $("#disconnect-sheets").addEventListener("click", () => {
    sheetConfig = null;
    clearTimeout(sheetRetryTimer);
    sheetRetryTimer = null;
    try {
      localStorage.removeItem(SHEETS_CONFIG_KEY);
      setSheetStatus("Data lokal saja", "");
      closeSheetSettings();
      showToast("Koneksi Google Sheets diputus. Data lokal tidak dihapus.");
    } catch (error) {
      console.error("Gagal memutus koneksi Google Sheets:", error);
      $("#sheet-config-error").textContent = "Konfigurasi gagal dihapus dari browser.";
    }
  });
  $("#sheet-settings-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const urlValue = $("#sheet-url").value.trim();
    const rawApiKey = $("#sheet-api-key").value.trim();
    const apiKey = rawApiKey
      .replace(/^(?:Info\s+)?(?:QR Desk API key \(simpan privat\)|API key baru \(simpan privat\)):\s*/i, "")
      .trim();
    let url;
    try {
      url = new URL(urlValue);
    } catch (error) {
      $("#sheet-config-error").textContent = "URL Web App tidak valid.";
      return;
    }
    if (url.protocol !== "https:" || url.hostname !== "script.google.com" || !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname)) {
      $("#sheet-config-error").textContent = "Masukkan URL Apps Script Web App yang valid.";
      return;
    }
    if (!/^[a-f0-9]{64}$/i.test(apiKey)) {
      $("#sheet-config-error").textContent = "API key harus 64 karakter heksadesimal. Salin hanya nilai key dari Execution log, tanpa label.";
      return;
    }
    sheetConfig = { url: url.toString(), apiKey, initialized: false };
    if (!saveSheetConfig()) return;
    try {
      await synchronizeSpreadsheet(true);
      closeSheetSettings();
      showToast("Spreadsheet terhubung dan data berhasil disinkronkan.");
    } catch (error) {
      $("#sheet-config-error").textContent = error.message;
    }
  });

  function scanRow(scan) {
    const qr = database.qrs.find((item) => item.id === scan.qrId);
    const label = qr ? qr.name : scan.label;
    return `<tr><td><span class="qr-name"><span class="mini-qr">▦</span>${escapeHtml(label)}</span></td><td><span class="code-label">${escapeHtml(scan.code)}</span></td><td>${formatDateTime(scan.scannedAt)}</td><td><span class="source-pill">${scan.source === "camera" ? "Kamera" : "Manual"}</span></td><td><span class="status-pill">Berhasil</span></td></tr>`;
  }

  function renderHistory() {
    const query = $("#history-search").value.trim().toLowerCase();
    const scans = database.scans.filter((scan) => {
      const qr = database.qrs.find((item) => item.id === scan.qrId);
      return `${qr ? qr.name : scan.label} ${scan.code}`.toLowerCase().includes(query);
    });
    $("#history-list").innerHTML = [...scans].reverse().map(scanRow).join("");
    $("#history-count").textContent = database.scans.length;
    $("#history-empty").classList.toggle("is-hidden", scans.length > 0);
    $("#history-list").classList.toggle("is-hidden", scans.length === 0);
  }

  function renderRecentScans() {
    const scans = [...database.scans].reverse().slice(0, 5);
    $("#recent-scans").innerHTML = scans.map((scan) => {
      const qr = database.qrs.find((item) => item.id === scan.qrId);
      return `<tr><td><span class="qr-name"><span class="mini-qr">▦</span>${escapeHtml(qr ? qr.name : scan.label)}</span></td><td><span class="code-label">${escapeHtml(scan.code)}</span></td><td>${formatDateTime(scan.scannedAt)}</td><td><span class="source-pill">${scan.source === "camera" ? "Kamera" : "Manual"}</span></td><td><span class="status-pill">Berhasil</span></td></tr>`;
    }).join("");
    $("#recent-empty").classList.toggle("is-hidden", scans.length > 0);
    $("#recent-scans").classList.toggle("is-hidden", scans.length === 0);
  }

  $("#qr-search").addEventListener("input", renderQrList);
  $("#history-search").addEventListener("input", renderHistory);

  function deleteQr(id) {
    const qr = database.qrs.find((item) => item.id === id);
    if (!qr || !window.confirm(`Hapus "${qr.name}"? Riwayat scan yang sudah tercatat tetap disimpan.`)) return;
    database.qrs = database.qrs.filter((item) => item.id !== id);
    if (saveDatabase()) {
      render();
      syncMutation("deleteQr", { id });
      showToast("Kode QR berhasil dihapus.");
    }
  }

  const modal = $("#qr-modal");
  function openModal() {
    modal.classList.remove("is-hidden");
    $("#qr-name").focus();
  }
  function closeModal() {
    modal.classList.add("is-hidden");
    $("#create-qr-form").reset();
  }
  $$("[data-open-create]").forEach((button) => button.addEventListener("click", openModal));
  $("#close-modal").addEventListener("click", closeModal);
  $("#cancel-modal").addEventListener("click", closeModal);
  modal.addEventListener("click", (event) => { if (event.target === modal) closeModal(); });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeModal();
      closeQrPreview();
      closeSheetSettings();
    }
  });

  $("#create-qr-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const name = $("#qr-name").value.trim();
    if (!name) return;
    const nextNumber = database.qrs.reduce((max, qr) => {
      const match = /^QR-(\d+)$/.exec(qr.code);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0) + 1;
    const qr = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      category: $("#qr-category").value,
      code: `QR-${String(nextNumber).padStart(3, "0")}`,
      createdAt: new Date().toISOString(),
      active: true
    };
    database.qrs.push(qr);
    if (saveDatabase()) {
      closeModal();
      render();
      navigate("codes");
      syncMutation("upsertQr", { record: qr });
      showToast("Kode QR berhasil dibuat.");
    }
  });

  function recordScan(rawCode, source) {
    const code = rawCode.trim().toUpperCase();
    const qr = database.qrs.find((item) => item.code.toUpperCase() === code || item.id === rawCode.trim());
    if (!qr) {
      showToast(`Kode "${rawCode}" tidak terdaftar.`);
      $("#camera-error").textContent = "Kode QR tidak ditemukan di Data QR.";
      return false;
    }
    $("#camera-error").textContent = "";
    const scan = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      qrId: qr.id,
      label: qr.name,
      code: qr.code,
      scannedAt: new Date().toISOString(),
      source
    };
    database.scans.push(scan);
    if (!saveDatabase()) return false;
    render();
    renderScanResult(scan);
    syncMutation("appendScan", { record: scan });
    showToast(`Scan ${qr.code} berhasil dicatat.`);
    playScanSound();
    return true;
  }

  function renderScanResult(scan) {
    $("#last-scan").innerHTML = `<div class="scan-result"><span class="mini-qr">✓</span><strong>${escapeHtml(scan.label)}</strong><span>${escapeHtml(scan.code)}</span><small>${formatDateTime(scan.scannedAt)}</small></div>`;
  }

  function renderLastScan() {
    const last = database.scans[database.scans.length - 1];
    if (last) {
      renderScanResult(last);
      return;
    }
    $("#last-scan").innerHTML = '<div class="result-placeholder"><span>⌗</span><strong>Belum ada scan</strong><small>Hasil scan akan tampil di sini.</small></div>';
  }

  $("#manual-scan-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = $("#manual-code");
    prepareScanAudio();
    if (recordScan(input.value, "manual")) input.value = "";
  });

  async function startScanner() {
    $("#camera-error").textContent = "";
    if (!window.Html5Qrcode) {
      $("#camera-error").textContent = "Library scanner belum tersedia. Periksa koneksi internet lalu muat ulang halaman.";
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      $("#camera-error").textContent = "Kamera memerlukan HTTPS atau localhost dan izin akses kamera.";
      return;
    }
    prepareScanAudio();
    scanner = new Html5Qrcode("reader");
    try {
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 220, height: 220 }, aspectRatio: 1 },
        (decodedText) => {
          if (scanLocked) return;
          scanLocked = true;
          recordScan(decodedText, "camera");
          setTimeout(() => { scanLocked = false; }, 1800);
        },
        () => {}
      );
      $("#camera-placeholder").classList.add("is-hidden");
      $("#start-scanner").classList.add("is-hidden");
      $("#stop-scanner").classList.remove("is-hidden");
    } catch (error) {
      console.error("Scanner gagal dimulai:", error);
      $("#camera-error").textContent = "Kamera tidak dapat dimulai. Pastikan izin kamera diberikan dan tidak sedang digunakan aplikasi lain.";
      scanner = null;
    }
  }

  async function stopScanner() {
    if (!scanner) return;
    try {
      if (scanner.isScanning) await scanner.stop();
      scanner.clear();
    } catch (error) {
      console.error("Scanner gagal dihentikan:", error);
    }
    scanner = null;
    scanLocked = false;
    $("#camera-placeholder").classList.remove("is-hidden");
    $("#start-scanner").classList.remove("is-hidden");
    $("#stop-scanner").classList.add("is-hidden");
  }

  $("#start-scanner").addEventListener("click", startScanner);
  $("#stop-scanner").addEventListener("click", stopScanner);
  $("#clear-history").addEventListener("click", () => {
    if (!database.scans.length || !window.confirm("Hapus semua riwayat pemindaian? Tindakan ini tidak dapat dibatalkan.")) return;
    database.scans = [];
    if (saveDatabase()) {
      render();
      syncMutation("clearScans", {});
      showToast("Riwayat scan berhasil dihapus.");
    }
  });

  setSheetStatus(sheetConfig ? "Google Sheets tersimpan" : "Hubungkan Spreadsheet", sheetConfig ? "syncing" : "");
  if (sessionStorage.getItem(AUTH_KEY) === "true") setAuthenticated(true);
})();
