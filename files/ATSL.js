/* ATSL.js 0.1.1-a.2+bn.2. */


(() => {
  // --- tiny helpers ---
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from((root || document).querySelectorAll(sel));
  const pad = n => (n < 10 ? "0" + n : String(n));

  // Display format (no month/year)
  const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  function formatShort(dt) {
    const day = DAYS[dt.getDay()];
    let h = dt.getHours();
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return `${day}, ${h}:${pad(dt.getMinutes())} ${ampm}`;
  }
  function fmtDuration(mins) {
    mins = Math.round(mins);
    const h = Math.floor(mins / 60);
    const m = Math.abs(mins % 60);
    if (h > 0) return `${h}h ${pad(m)}m`;
    return `${m}m`;
  }

  // Normalize input: "6:31PM" -> "6:31 PM", fix commas spacing
  function normalizeInput(s) {
    if (!s) return s;
    let t = s.trim();
    t = t.replace(/([0-9])([APMapm]{2})\b/, '$1 $2'); // "6:31PM" -> "6:31 PM"
    t = t.replace(/,\s*/, ', ');
    return t;
  }

  // Parse start text to a Date
  function parseToDate(input) {
    if (!input) return new Date();
    const s = normalizeInput(input);
    const p = Date.parse(s);
    if (!isNaN(p)) return new Date(p);

    const wdMatch = s.match(/\b(Sun|Mon|Tue|Tues|Wed|Thu|Thur|Fri|Sat|Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\b/i);
    const timeMatch = s.match(/(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?/);
    const now = new Date();

    if (wdMatch && timeMatch) {
      const token = wdMatch[0].toLowerCase().slice(0,3);
      const map = { sun:0, mon:1, tue:2, wed:3, thu:4, fri:5, sat:6 };
      const targetWd = map[token] ?? 0;
      const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const todayWd = candidate.getDay();
      let daysUntil = (targetWd - todayWd + 7) % 7;
      candidate.setDate(candidate.getDate() + daysUntil);

      let hour = parseInt(timeMatch[1], 10);
      const minute = parseInt(timeMatch[2], 10);
      const ampm = timeMatch[3];
      if (ampm) {
        const a = ampm.toLowerCase();
        if (a === "pm" && hour !== 12) hour += 12;
        if (a === "am" && hour === 12) hour = 0;
      }
      candidate.setHours(hour, minute, 0, 0);
      if (candidate.getTime() < now.getTime() - 1000) candidate.setDate(candidate.getDate() + 7);
      return candidate;
    }

    if (!wdMatch && timeMatch) {
      let hour = parseInt(timeMatch[1], 10);
      const minute = parseInt(timeMatch[2], 10);
      const ampm = timeMatch[3];
      if (ampm) {
        const a = ampm.toLowerCase();
        if (a === "pm" && hour !== 12) hour += 12;
        if (a === "am" && hour === 12) hour = 0;
      }
      const c = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);
      if (c.getTime() < now.getTime() - 1000) c.setDate(c.getDate() + 1);
      return c;
    }

    return new Date();
  }

  // --- DOM elements (match HTML IDs) ---
  const enterBtn = $("#enterable-fields-form-btn");
  const activeBtn = $("#enterable-fields-form-active-btn");
  const recordsList = $("#records-list");
  const clearBtn = $("#records-clear-btn");
  const exportBtn = $("#records-export-btn");
  const shareMenu = $("#records-share-menu");
  const shareMenuBtn = $("#records-share-options-btn");
  const shareMenuCloseBtn = $("#record-share-menu-close-btn");
  const loadInput = $("#records-share-menu-form-input");
  const loadBtn = $("#records-share-menu-form-load-btn");
  const generateBtn = $("#records-share-menu-form-gener-btn");

  const popup = $("#confirm-record-popup");
  const popupSubmit = $("#confirm-record-popup-submit");
  const popupCancel = $("#confirm-record-popup-cancel");

  const activeWrap = $("#active-job");
  const activeStatic = $("#active-job-form-staticdetails");
  const ed1 = $("#ed-1"), ed2 = $("#ed-2"), ed3 = $("#ed-3"), ed4 = $("#ed-4");
  const gameTimeEl = $("#game-time"), totalDriveEl = $("#total-job-drivetime"), nextBreakEl = $("#next-breakin");
  const takeBreakBtn = $("#active-job-form-dynamicdetails-startbreak");
  const goOnDutyBtn = $("#active-job-form-dynamicdetails-gooffbreak");
  const editBtn = $("#active-job-form-edit-details-btn");
  const removeBtn = $("#active-job-form-remove-btn");
  const addRecordActiveBtn = $("#active-job-form-addrecord-btn");

  const editPanel = $("#active-job-edit-editabledetails");
  const editValueContainer = $("#active-job-edit-editabledetails-value");
  const editValueInput = $("#ed-edited-value");
  const editValueApply = $("#ed-edited-value-apply-btn");
  const editValueClose = $("#active-job-edit-editabledetails-close-btn");
  const linkEd1 = $("#edit-ed-1"), linkEd2 = $("#edit-ed-2"), linkEd3 = $("#edit-ed-3"), linkEd4 = $("#edit-ed-4");

  // --- State & constants ---
  let activeJob = null;
  let simRunning = false;
  let raf = null;
  let lastReal = 0;
  let lastGameMinuteId = null;

  const GAME_SPEED = 15; // 1:15
  const MAX_DRIVE_MIN = 14 * 60;
  const WARN_YELLOW_MIN = 7 * 60;
  const WARN_RED_MIN = 10 * 60;
  const BREAK_MIN = 10 * 60; // 10 hours -> minutes

  // --- Helpers for form values ---
  function collectForm() {
    const arr = $$(".enterable-fields-form-input").map(i => i.value.trim());
    while (arr.length < 10) arr.push("");
    return arr;
  }

  function hasActiveRequired(arr) {
    // required indices: 0 Trucking Company, 1 Driver, 3 Customer, 4 DeliveredTo, 5 Cargo, 6 Start
    const req = [0,1,3,4,5,6];
    return req.every(i => arr[i] && arr[i].length > 0);
  }

  function buildActiveFrom(vals) {
    while (vals.length < 10) vals.push("");
    const [
      truckingcompany, driver, truck,
      customer, deliveredTo, cargo,
      startRaw, endStr, inspections, miles
    ] = vals.map(v => v || "");

    const startNormalized = normalizeInput(startRaw);
    const parsedStart = parseToDate(startNormalized);

    return {
      truckingcompany, driver, truck, customer, deliveredTo, cargo,
      startRaw: startNormalized, endStr, inspections, miles,
      startGameTime: new Date(parsedStart.getTime()),
      currentGameTime: new Date(parsedStart.getTime()),
      totalDriveMinutes: 0,   // cumulative
      driveSinceReset: 0,     // used for next-breakin; resets on "Go On Duty"
      isDriving: true,
      breakInProgress: false,
      breaks: [] // { start:ms, end:ms } or { note }
    };
  }

  // --- UI show/hide & formatting ---
  function showActiveUI() {
    if (!activeJob) return;
    activeWrap.style.display = "";
    activeStatic.innerHTML = `<b>Trucking Company:</b> ${activeJob.truckingcompany} <b>Driver:</b> ${activeJob.driver} <b>Customer:</b> ${activeJob.customer} <b>Delivered To:</b> ${activeJob.deliveredTo} <b>Cargo:</b> ${activeJob.cargo} <b>Start:</b> ${formatShort(activeJob.startGameTime)}`;
    ed1.innerHTML = `<b>End:</b> ${activeJob.endStr || ""}`;
    ed2.innerHTML = `<b>Inspections:</b> ${activeJob.inspections || ""}`;
    ed3.innerHTML = `<b>Miles:</b> ${activeJob.miles || ""}`;
    ed4.innerHTML = `<b>Breaks:</b> ${formatBreaks(activeJob.breaks)}`;
    updateSimUI();
  }
  function hideActiveUI() {
    activeWrap.style.display = "none";
  }
  function formatBreaks(arr) {
    if (!arr || arr.length === 0) return "None";
    return arr.map((b, i) => {
      if (b.note) return `B${i+1} Note: ${b.note}`;
      const s = b.start ? formatShort(new Date(b.start)) : "??";
      const e = b.end ? formatShort(new Date(b.end)) : "In progress";
      return `B${i+1} ${s} - ${e}`;
    }).join(" ; ");
  }

  // --- Simulation core ---
  function startSim() {
    if (!activeJob || simRunning) return;
    simRunning = true;
    lastReal = performance.now();
    lastGameMinuteId = Math.floor(activeJob.currentGameTime.getTime() / 60000);
    raf = requestAnimationFrame(simLoop);
  }

  function stopSim() {
    if (!simRunning) return;
    simRunning = false;
    if (raf) cancelAnimationFrame(raf);
    raf = null;
  }

  function simLoop(now) {
    if (!simRunning || !activeJob) return;
    const deltaReal = now - lastReal;
    lastReal = now;
    const advMs = deltaReal * GAME_SPEED;
    activeJob.currentGameTime = new Date(activeJob.currentGameTime.getTime() + advMs);

    const curMinuteId = Math.floor(activeJob.currentGameTime.getTime() / 60000);
    if (curMinuteId !== lastGameMinuteId) {
      lastGameMinuteId = curMinuteId;
      if (activeJob.isDriving && !activeJob.breakInProgress) {
        activeJob.totalDriveMinutes += 1;
        activeJob.driveSinceReset += 1;
      }
    }

    updateSimUI();
    raf = requestAnimationFrame(simLoop);
  }

  function updateSimUI() {
    if (!activeJob) return;
    gameTimeEl.textContent = `${formatShort(activeJob.currentGameTime)}`;
    totalDriveEl.textContent = `${fmtDuration(activeJob.totalDriveMinutes)}`;
    const remaining = Math.max(0, MAX_DRIVE_MIN - activeJob.driveSinceReset);
    nextBreakEl.textContent = `${fmtDuration(remaining)}`;
    if (activeJob.driveSinceReset >= WARN_RED_MIN) nextBreakEl.style.color = "red";
    else if (activeJob.driveSinceReset >= WARN_YELLOW_MIN) nextBreakEl.style.color = "orange";
    else nextBreakEl.style.color = "";
    ed4.innerHTML = `<b>Breaks:</b> ${formatBreaks(activeJob.breaks)}`;
  }

  // --- Records persistence & helpers ---
  function saveRecords() {
    const records = Array.from(recordsList.querySelectorAll(".records-list-record")).map(p => {
      return {
        innerHTML: p.innerHTML,
        // Store raw data for JSON export
        rawData: p.rawData || null
      };
    });
    localStorage.setItem("ats_records", JSON.stringify(records));
  }

  (function loadRecords() {
    const saved = JSON.parse(localStorage.getItem("ats_records") || "[]");
    saved.forEach((item, idx) => {
      const p = document.createElement("p");
      p.className = "records-list-record";
      if (idx % 2 === 0) p.classList.add("gray");
      p.innerHTML = item.innerHTML;
      // Preserve raw data if it exists
      if (item.rawData) p.rawData = item.rawData;
      recordsList.appendChild(p);
    });
  })();

  // --- UI actions (main form submit -> popup preview) ---
  enterBtn && enterBtn.addEventListener("click", (ev) => {
    ev.preventDefault();
    const vals = collectForm();
        
    // Require same fields as activeBtn
    if (!hasActiveRequired(vals)) {
        alert("Please fill: Trucking Company, Driver, Truck, Customer, Delivered To, Cargo, Start time, End Time, Inspections, Miles.");
            return;
    }
        
    const preview = [
      `Trucking Company: ${vals[0] || ""}`,
      `Driver: ${vals[1] || ""}`,
      `Truck: ${vals[2] || ""}`,
      `Customer: ${vals[3] || ""}`,
      `Delivered To: ${vals[4] || ""}`,
      `Cargo: ${vals[5] || ""}`,
      `Start: ${normalizeInput(vals[6] || "")}`,
      `End: ${vals[7] || ""}`,
      `Inspections: ${vals[8] || ""}`,
      `Miles: ${vals[9] || ""}`
    ].join(" | ");
    if (popup) {
      popup.querySelector("p").textContent = preview;
      popup.style.display = "block";
      popup._pending = vals;
    } else {
      // If popup missing, create record directly (fallback)
      addRecordFromValues(vals);
    }
  });

  // Popup handlers
  popupSubmit && popupSubmit.addEventListener("click", () => {
    const vals = popup._pending || collectForm();
    popup._pending = null;
    popup.style.display = "none";
    addRecordFromValues(vals);
  });
  popupCancel && popupCancel.addEventListener("click", () => {
    popup._pending = null;
    if (popup) popup.style.display = "none";
  });

  function addRecordFromValues(vals) {
    const v = Array.from(vals || []);
    while (v.length < 10) v.push("");
    const [truckingcompany, driver, truck, customer, deliveredTo, cargo, startStr, endStr, inspections, miles] = v;
    const p = document.createElement("p");
    p.className = "records-list-record";
    if (recordsList.querySelectorAll(".records-list-record").length % 2 === 0) p.classList.add("gray");
    p.innerHTML = `
      <b>Trucking Company:</b> ${truckingcompany}
      <b>Driver:</b> ${driver}
      <b>Truck:</b> ${truck}
      <b>Customer:</b> ${customer}
      <b>Delivered To:</b> ${deliveredTo}
      <b>Cargo:</b> ${cargo}
      <b>Start Time:</b> ${startStr}
      <b>End Time:</b> ${endStr}
      <b>Inspections:</b> ${inspections}
      <b>Miles:</b> ${miles}.
    `;
    
    // Store raw data for JSON export
    p.rawData = {
      truckingcompany, driver, truck, customer, deliveredTo, cargo,
      start: startStr, end: endStr, inspections, miles,
      breaks: [] // No breaks in regular form submission
    };
    
    recordsList.appendChild(p);
    saveRecords();
    // clear form inputs
    $$(".enterable-fields-form-input").forEach(i => i.value = "");
  }

  // --- Active job: MARK AS ACTIVE ---
  activeBtn && activeBtn.addEventListener("click", () => {
    const vals = collectForm();
    if (!hasActiveRequired(vals)) {
      alert("Please fill: Trucking Company, Driver, Customer, Delivered To, Cargo, Start time.");
      return;
    }
    activeJob = buildActiveFrom(vals);
    // reset driveSinceReset, but keep cumulative totalDriveMinutes at 0 (fresh job)
    activeJob.driveSinceReset = 0;
    activeJob.totalDriveMinutes = 0;
    activeJob.isDriving = true;
    activeJob.breakInProgress = false;
    showActiveUI();
    startSim();
  });

  // TAKE BREAK
  takeBreakBtn && takeBreakBtn.addEventListener("click", () => {
    if (!activeJob) { alert("No active job."); return; }
    if (activeJob.breakInProgress) { alert("Break already in progress."); return; }

    // pause driving
    activeJob.isDriving = false;
    activeJob.breakInProgress = true;
    const startMs = activeJob.currentGameTime.getTime();
    activeJob.breaks.push({ start: startMs, end: null });

    // advance game-time by 10 hours (in-game)
    activeJob.currentGameTime = new Date(activeJob.currentGameTime.getTime() + BREAK_MIN * 60 * 1000);

    // avoid minute double count
    lastGameMinuteId = Math.floor(activeJob.currentGameTime.getTime() / 60000);
    if (!simRunning) startSim();
    updateSimUI();
  });

  // GO ON DUTY
  goOnDutyBtn && goOnDutyBtn.addEventListener("click", () => {
    if (!activeJob) { alert("No active job."); return; }
    if (!activeJob.breakInProgress) { alert("Not on break."); return; }

    // mark break end
    const lastB = activeJob.breaks[activeJob.breaks.length - 1];
    if (lastB) lastB.end = activeJob.currentGameTime.getTime();

    activeJob.breakInProgress = false;
    activeJob.isDriving = true;

    // Reset only driveSinceReset so next-breakin returns to 14 hours.
    // DO NOT reset totalDriveMinutes (cumulative).
    activeJob.driveSinceReset = 0;
    lastGameMinuteId = Math.floor(activeJob.currentGameTime.getTime() / 60000);
    updateSimUI();
  });

  // EDIT panel open
  editBtn && editBtn.addEventListener("click", () => {
    if (!activeJob) return;
    // ensure the panel uses block so your CSS works consistently
    if (editPanel) editPanel.style.display = "block";
    if (editValueContainer) editValueContainer.style.display = "none";
  });

  // open edit links
  function openEdit(which) {
    if (!activeJob) return;
    if (editValueContainer) editValueContainer.style.display = "block";
    let cur = "";
    if (which === "ed-1") cur = activeJob.endStr || "";
    if (which === "ed-2") cur = activeJob.inspections || "";
    if (which === "ed-3") cur = activeJob.miles || "";
    if (which === "ed-4") cur = "";
    if (editValueInput) { editValueInput.value = cur; editValueInput.dataset.which = which; }
  }
  linkEd1 && linkEd1.addEventListener("click", e => { e.preventDefault(); openEdit("ed-1"); });
  linkEd2 && linkEd2.addEventListener("click", e => { e.preventDefault(); openEdit("ed-2"); });
  linkEd3 && linkEd3.addEventListener("click", e => { e.preventDefault(); openEdit("ed-3"); });
  linkEd4 && linkEd4.addEventListener("click", e => { e.preventDefault(); openEdit("ed-4"); });

  // apply edit
  editValueApply && editValueApply.addEventListener("click", (e) => {
    e.preventDefault();
    const which = (editValueInput && editValueInput.dataset.which) || "";
    const v = (editValueInput && editValueInput.value.trim()) || "";
    if (!activeJob || !which) return;
    if (which === "ed-1") { activeJob.endStr = v; ed1.innerHTML = `<b>End:</b> ${v}`; }
    if (which === "ed-2") { activeJob.inspections = v; ed2.innerHTML = `<b>Inspections:</b> ${v}`; }
    if (which === "ed-3") { activeJob.miles = v; ed3.innerHTML = `<b>Miles:</b> ${v}`; }
    if (which === "ed-4") { activeJob.breaks.push({ note: v }); ed4.innerHTML = `<b>Breaks:</b> ${formatBreaks(activeJob.breaks)}`; }
    if (editValueInput) { editValueInput.value = ""; editValueInput.dataset.which = ""; editValueContainer.style.display = "none"; }
  });

  editValueClose && editValueClose.addEventListener("click", (e) => {
    e.preventDefault();
    if (editPanel) editPanel.style.display = "none";
    if (editValueContainer) editValueContainer.style.display = "none";
  });

  // REMOVE active job
  removeBtn && removeBtn.addEventListener("click", () => {
    if (!activeJob) return;
    if (!confirm("Remove active job? This will stop the timer and reset totals.")) return;
    stopSim();
    activeJob = null;
    hideActiveUI();
    gameTimeEl.textContent = "";
    totalDriveEl.textContent = `0m`;
    nextBreakEl.textContent = `${fmtDuration(MAX_DRIVE_MIN)}`;
    nextBreakEl.style.color = "";
  });

  // SUBMIT active job as record (includes breaks)
  addRecordActiveBtn && addRecordActiveBtn.addEventListener("click", () => {
    if (!activeJob) return;
    const p = document.createElement("p");
    p.className = "records-list-record";
    if (recordsList.querySelectorAll(".records-list-record").length % 2 === 0) p.classList.add("gray");
    
    const breaksSummary = formatBreaks(activeJob.breaks);
    p.innerHTML = `
      <b>Trucking Company:</b> ${activeJob.truckingcompany}
      <b>Driver:</b> ${activeJob.driver}
      <b>Truck:</b> ${activeJob.truck}
      <b>Customer:</b> ${activeJob.customer}
      <b>Delivered To:</b> ${activeJob.deliveredTo}
      <b>Cargo:</b> ${activeJob.cargo}
      <b>Start Time:</b> ${formatShort(activeJob.startGameTime)}
      <b>End Time:</b> ${activeJob.endStr || ""}
      <b>Inspections:</b> ${activeJob.inspections || ""}
      <b>Miles:</b> ${activeJob.miles || ""}
      ${breaksSummary && breaksSummary !== "None" ? `<b>Breaks:</b> ${breaksSummary}` : ""}
    `;
    
    // Store raw data including breaks
    p.rawData = {
      truckingcompany: activeJob.truckingcompany,
      driver: activeJob.driver,
      truck: activeJob.truck,
      customer: activeJob.customer,
      deliveredTo: activeJob.deliveredTo,
      cargo: activeJob.cargo,
      start: formatShort(activeJob.startGameTime),
      end: activeJob.endStr || "",
      inspections: activeJob.inspections || "",
      miles: activeJob.miles || "",
      breaks: activeJob.breaks // Store the actual break objects
    };
    
    recordsList.appendChild(p);
    saveRecords();
    stopSim();
    activeJob = null;
    hideActiveUI();
    gameTimeEl.textContent = "";
    totalDriveEl.textContent = `0m`;
    nextBreakEl.textContent = `${fmtDuration(MAX_DRIVE_MIN)}`;
    nextBreakEl.style.color = "";
  });

  // RESET records
  clearBtn && clearBtn.addEventListener("click", () => {
    if (!confirm("Clear all saved records?")) return;
    recordsList.innerHTML = "";
    localStorage.removeItem("ats_records");
  });

  // EXPORT PDF
  exportBtn && exportBtn.addEventListener("click", () => {
    try {
      if (!window.jspdf) { alert("jsPDF not loaded."); return; }
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ orientation: "p", unit: "mm", format: "a4" });

      const margin = 10;
      const logoHeight = 16; // must match height used in addImage
      const spacing = 6;     // extra space between logo and text
      let y = margin + logoHeight + spacing; // start text below logo
      const pageH = 297;
      const maxW = 190;
      const lh = 7;

      // Add logo at top-left
      const logoImg = 'data:image/png;base64,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';
      doc.addImage(logoImg, "PNG", 10, margin, 62, logoHeight); // x, y, width, height

      // Title
      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.text("American Truck Simulator Job Log Report", margin, y);
      y += 8;

      // Generated date
      doc.setFont("helvetica", "normal");
      doc.setFontSize(11);
      const now = new Date();
      doc.text(`Generated: ${now.toLocaleString("en-US", { month:"long", day:"numeric", year:"numeric", hour:"numeric", minute:"2-digit" })}`, margin, y);
      y += 10;

      // Records
      const recEls = Array.from(recordsList.querySelectorAll(".records-list-record"));
      recEls.forEach(r => {
        const fields = [];
        const bs = r.querySelectorAll("b");
        bs.forEach(b => {
          const label = b.textContent.replace(/:$/,'').trim();
          let value = "";
          if (b.nextSibling && b.nextSibling.nodeType === Node.TEXT_NODE) value = b.nextSibling.textContent.trim();
          else if (b.nextElementSibling) value = b.nextElementSibling.textContent.trim();
          fields.push(`${label}: ${value}`);
        });
        const line = fields.join(" | ").replace(/\s{2,}/g, " ");
        const w = doc.getTextWidth(line);
        const wrapped = (w > maxW) ? doc.splitTextToSize(line, maxW) : [line];
        if (y + wrapped.length * lh > pageH - margin) { doc.addPage(); y = margin; }
        doc.setFontSize(11);
        doc.text(wrapped, margin, y);
        y += wrapped.length * lh;
      });

      doc.save(`ATS_Job_Records_${now.toISOString().split("T")[0]}.pdf`);
    } catch (err) {
      console.error("Export error:", err);
      alert("Failed to export records. Check console.");
    }
  });

  // =========================
  // RECORD SHARE / LOAD MENU
  // =========================

  // Hide menu on start
  shareMenu.style.display = "none";

  // --- OPEN SHARE MENU ---
  shareMenuBtn.addEventListener("click", () => {
    shareMenu.style.display = (shareMenu.style.display === "none" ? "block" : "none");
  });

  // --- CLOSE SHARE MENU ---
  shareMenuCloseBtn.addEventListener("click", () => {
    shareMenu.style.display = "none";
  });

  // =========================
  // LOAD JSON FILE OF RECORDS
  // =========================
  loadBtn.addEventListener("click", () => {
    const file = loadInput.files[0];
    if (!file) {
      alert("No JSON file selected.");
      return;
    }

    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        const data = JSON.parse(e.target.result);

        if (!Array.isArray(data)) {
          alert("Invalid JSON format. Must be an array of record objects.");
          return;
        }

        // Clear existing displayed records
        recordsList.innerHTML = "";

        // Rebuild formatted records
        data.forEach(rec => {
          const p = document.createElement("p");
          p.className = "records-list-record";
          if (recordsList.querySelectorAll(".records-list-record").length % 2 === 0) p.classList.add("gray");
          
          const breaksSummary = rec.breaks && rec.breaks.length ? formatBreaks(rec.breaks) : "";
          
          p.innerHTML = `
            <b>Trucking Company:</b> ${rec.truckingcompany || ""}
            <b>Driver:</b> ${rec.driver || ""}
            <b>Truck:</b> ${rec.truck || ""}
            <b>Customer:</b> ${rec.customer || ""}
            <b>Delivered To:</b> ${rec.deliveredTo || ""}
            <b>Cargo:</b> ${rec.cargo || ""}
            <b>Start Time:</b> ${rec.start || ""}
            <b>End Time:</b> ${rec.end || ""}
            <b>Inspections:</b> ${rec.inspections || ""}
            <b>Miles:</b> ${rec.miles || ""}
            ${breaksSummary && breaksSummary !== "None" ? `<b>Breaks:</b> ${breaksSummary}` : ""}
          `;
          
          // Store the raw data for future JSON export
          p.rawData = rec;
          
          recordsList.appendChild(p);
        });

        saveRecords();
        alert("Records loaded successfully!");

      } catch (err) {
        alert("Error reading JSON file.");
        console.error(err);
      }
    };

    reader.readAsText(file);
  });

  // =========================
  // GENERATE JSON FROM RECORDS
  // =========================
  generateBtn.addEventListener("click", () => {
    const items = [...recordsList.querySelectorAll(".records-list-record")];
    
    const output = items.map(p => {
      // Use rawData if available, otherwise fall back to parsing HTML
      if (p.rawData) {
        return p.rawData;
      }
      
      // Fallback: parse HTML (for old records)
      const obj = {
        truckingcompany: "", driver: "", truck: "", customer: "", deliveredTo: "",
        cargo: "", start: "", end: "", inspections: "", miles: "", breaks: []
      };

      const bs = p.querySelectorAll("b");
      bs.forEach(b => {
        let label = b.textContent.replace(/:$/, "").trim();
        let value = "";
        if (b.nextSibling && b.nextSibling.nodeType === Node.TEXT_NODE) {
          value = b.nextSibling.textContent.trim();
        }
        value = value.replace(/^\s+|\s+$/g, "");

        switch (label) {
          case "Trucking Company": obj.truckingcompany = value; break;
          case "Driver": obj.driver = value; break;
          case "Truck": obj.truck = value; break;
          case "Customer": obj.customer = value; break;
          case "Delivered To": obj.deliveredTo = value; break;
          case "Cargo": obj.cargo = value; break;
          case "Start Time": obj.start = value; break;
          case "End Time": obj.end = value; break;
          case "Inspections": obj.inspections = value; break;
          case "Miles": obj.miles = value; break;
          case "Breaks":
            // Skip breaks in fallback since we can't parse them reliably
            break;
        }
      });
      return obj;
    });

    const json = JSON.stringify(output, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "ATSL_records.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    URL.revokeObjectURL(url);
    alert("JSON generated & downloaded.");
  });

  // --- initial UI state ---
  hideActiveUI();
  if (nextBreakEl) nextBreakEl.textContent = `${fmtDuration(MAX_DRIVE_MIN)}`;

  // Expose for debugging
  window.atsl = { getActiveJob: () => activeJob, startSim: () => startSim(), stopSim: () => stopSim() };
})();
