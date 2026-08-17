import {
  CANCEL_SUGGESTIONS,
  CHECKPOINT_IDS,
  POINTS,
  applyScan,
  cancelTour,
  createAgent,
  getClosingScan,
  getPointProgress,
  getScannedCheckpointIds,
  getTourPhase,
  startTour
} from "./patrol.js";
import {
  addTourToHistory,
  clearAgent,
  loadActiveTour,
  loadAgent,
  loadTourHistory,
  saveActiveTour,
  saveAgent
} from "./storage.js";

const state = {
  agent: loadAgent(),
  activeTour: loadActiveTour(),
  history: loadTourHistory(),
  pendingStart: false,
  lastOutcomeTour: null,
  scannerOpen: false,
  cancelOpen: false,
  selectedCancelReason: ""
};

const scanner = {
  detector: null,
  stream: null,
  loopId: null,
  locked: false
};

const dom = {
  mainView: document.getElementById("mainView"),
  switchAgentButton: document.getElementById("switchAgentButton"),
  toast: document.getElementById("toast"),
  scannerSheet: document.getElementById("scannerSheet"),
  closeScannerButton: document.getElementById("closeScannerButton"),
  scannerTitle: document.getElementById("scannerTitle"),
  scannerVideo: document.getElementById("scannerVideo"),
  cameraState: document.getElementById("cameraState"),
  startCameraButton: document.getElementById("startCameraButton"),
  manualScanForm: document.getElementById("manualScanForm"),
  manualCode: document.getElementById("manualCode"),
  cancelSheet: document.getElementById("cancelSheet"),
  closeCancelButton: document.getElementById("closeCancelButton"),
  cancelReason: document.getElementById("cancelReason"),
  confirmCancelButton: document.getElementById("confirmCancelButton")
};

let toastTimer = null;

bindEvents();
render();
registerServiceWorker();

function bindEvents() {
  dom.switchAgentButton.addEventListener("click", () => {
    clearAgent();
    saveActiveTour(null);
    state.agent = null;
    state.activeTour = null;
    state.pendingStart = false;
    state.lastOutcomeTour = null;
    render();
  });

  dom.mainView.addEventListener("submit", (event) => {
    if (event.target.id !== "loginForm") {
      return;
    }

    event.preventDefault();
    const formData = new FormData(event.target);
    const agent = createAgent({
      name: formData.get("agentName"),
      badge: formData.get("agentBadge")
    });

    if (!agent) {
      showToast("Nom et matricule requis");
      return;
    }

    state.agent = agent;
    saveAgent(agent);
    render();
  });

  dom.mainView.addEventListener("click", (event) => {
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (!action) {
      return;
    }

    if (action === "start") {
      state.pendingStart = true;
      state.lastOutcomeTour = null;
      render();
      openScanner();
    }

    if (action === "scan") {
      openScanner();
    }

    if (action === "cancel") {
      openCancelSheet();
    }

    if (action === "new-tour") {
      state.pendingStart = true;
      state.lastOutcomeTour = null;
      render();
      openScanner();
    }
  });

  dom.closeScannerButton.addEventListener("click", closeScanner);
  dom.startCameraButton.addEventListener("click", startCamera);

  dom.manualScanForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const rawCode = dom.manualCode.value.trim();
    if (!rawCode) {
      showToast("Code QR requis");
      return;
    }

    handleScan(rawCode);
  });

  dom.scannerSheet.addEventListener("click", (event) => {
    if (event.target === dom.scannerSheet) {
      closeScanner();
      return;
    }

    const testCode = event.target.closest("[data-test-scan]")?.dataset.testScan;
    if (testCode) {
      handleScan(testCode);
    }
  });

  dom.closeCancelButton.addEventListener("click", closeCancelSheet);
  dom.cancelSheet.addEventListener("click", (event) => {
    if (event.target === dom.cancelSheet) {
      closeCancelSheet();
      return;
    }

    const reason = event.target.closest("[data-reason]")?.dataset.reason;
    if (!reason) {
      return;
    }

    state.selectedCancelReason = state.selectedCancelReason === reason ? "" : reason;
    dom.cancelReason.value = state.selectedCancelReason;
    updateReasonButtons();
  });

  dom.confirmCancelButton.addEventListener("click", () => {
    const reason = dom.cancelReason.value.trim();
    const cancelled = cancelTour(state.activeTour, reason);
    if (!cancelled) {
      closeCancelSheet();
      return;
    }

    addTourToHistory(cancelled);
    state.history = loadTourHistory();
    state.lastOutcomeTour = cancelled;
    state.activeTour = null;
    state.pendingStart = false;
    saveActiveTour(null);
    closeCancelSheet();
    showToast("Tournée annulée");
    render();
  });
}

function render() {
  dom.switchAgentButton.hidden = !state.agent;
  dom.switchAgentButton.textContent = state.agent ? state.agent.badge : "Agent";

  if (!state.agent) {
    dom.mainView.innerHTML = renderLogin();
    return;
  }

  if (state.activeTour) {
    dom.mainView.innerHTML = renderActiveTour(state.activeTour);
    return;
  }

  if (state.pendingStart) {
    dom.mainView.innerHTML = renderPendingStart();
    return;
  }

  dom.mainView.innerHTML = renderReady();
}

function renderLogin() {
  return `
    <section class="login-panel">
      <div class="login-title">
        <p class="eyebrow">Connexion agent</p>
        <h2>Identité de service</h2>
      </div>
      <form class="field-stack" id="loginForm">
        <label>
          Nom complet
          <input name="agentName" type="text" autocomplete="name" required>
        </label>
        <label>
          Matricule
          <input name="agentBadge" type="text" autocomplete="off" required>
        </label>
        <button class="primary-button" type="submit">Se connecter</button>
      </form>
    </section>
  `;
}

function renderReady() {
  const latest = state.lastOutcomeTour || state.history[0] || null;
  return `
    <div class="stack">
      <section class="status-panel">
        <div class="status-top">
          <div>
            <p class="eyebrow">${escapeHtml(state.agent.name)}</p>
            <h2 class="status-title">Prêt pour une tournée</h2>
            <p class="status-copy">Poste de départ : Poste A</p>
          </div>
          <span class="status-pill idle">Libre</span>
        </div>
        <button class="primary-button" type="button" data-action="start">Scanner Poste A</button>
      </section>
      ${latest ? renderOutcome(latest) : ""}
      ${renderHistory()}
    </div>
  `;
}

function renderPendingStart() {
  return `
    <div class="stack">
      <section class="status-panel">
        <div class="status-top">
          <div>
            <p class="eyebrow">Démarrage</p>
            <h2 class="status-title">Poste A attendu</h2>
            <p class="status-copy">La tournée sera ouverte à l'heure du scan.</p>
          </div>
          <span class="status-pill pending">Attente</span>
        </div>
        ${renderPointRows(null)}
      </section>
      <div class="dock">
        <button class="primary-button" type="button" data-action="scan">Scanner Poste A</button>
      </div>
    </div>
  `;
}

function renderActiveTour(tour) {
  const checkpointCount = getScannedCheckpointIds(tour).size;
  const phase = getTourPhase(tour);
  const readyToClose = phase === "awaiting_close";
  const nextTitle = readyToClose ? "Retour Poste A" : "Points de contrôle";
  const nextCopy = readyToClose
    ? "Les trois points sont validés. Clôture par scan du Poste A."
    : "Les points peuvent être scannés dans n'importe quel ordre.";

  return `
    <div class="stack">
      <section class="status-panel">
        <div class="status-top">
          <div>
            <p class="eyebrow">Tournée active</p>
            <h2 class="status-title">${nextTitle}</h2>
            <p class="status-copy">${nextCopy}</p>
          </div>
          <span class="status-pill ${readyToClose ? "" : "pending"}">${readyToClose ? "Retour" : "En cours"}</span>
        </div>
        <div class="metric-strip">
          <div class="metric"><span>Départ</span><strong>${formatTime(tour.startedAt)}</strong></div>
          <div class="metric"><span>Validés</span><strong>${checkpointCount}/3</strong></div>
          <div class="metric"><span>Agent</span><strong>${escapeHtml(tour.agentBadge)}</strong></div>
        </div>
      </section>
      ${renderPointRows(tour)}
      <div class="dock">
        <button class="primary-button" type="button" data-action="scan">${readyToClose ? "Scanner Poste A" : "Scanner un point"}</button>
        <button class="secondary-button" type="button" data-action="cancel">Annuler</button>
      </div>
    </div>
  `;
}

function renderPointRows(tour) {
  const progress = getPointProgress(tour);
  const closingScan = getClosingScan(tour);
  const scannedCount = getScannedCheckpointIds(tour).size;
  const rows = progress.map(({ point, scan, done }) => {
    const locked = !tour && point.id !== "post-a";
    const next = !done && !locked;
    return `
      <article class="point-row ${done ? "done" : ""} ${next ? "next" : ""} ${locked ? "locked" : ""}">
        <span class="point-state">${done ? "✓" : locked ? "·" : "QR"}</span>
        <span class="point-main">
          <span class="point-name">${point.label}</span>
          <span class="point-kind">${point.kind}</span>
        </span>
        <span class="point-time">${scan ? formatTime(scan.scannedAt) : "--:--"}</span>
      </article>
    `;
  }).join("");

  const closeLocked = scannedCount !== CHECKPOINT_IDS.length;
  const closeDone = Boolean(closingScan);

  return `
    <section class="point-list">
      ${rows}
      <article class="point-row ${closeDone ? "done" : ""} ${!closeLocked && !closeDone ? "next" : ""} ${closeLocked ? "locked" : ""}">
        <span class="point-state">${closeDone ? "✓" : closeLocked ? "·" : "QR"}</span>
        <span class="point-main">
          <span class="point-name">Retour Poste A</span>
          <span class="point-kind">Clôture</span>
        </span>
        <span class="point-time">${closingScan ? formatTime(closingScan.scannedAt) : "--:--"}</span>
      </article>
    </section>
  `;
}

function renderOutcome(tour) {
  const isCompleted = tour.status === "completed";
  const title = isCompleted ? "Tournée clôturée" : "Tournée annulée";
  const subtitle = isCompleted
    ? `${formatTime(tour.startedAt)} - ${formatTime(tour.completedAt)}`
    : `${formatTime(tour.startedAt)} - ${formatTime(tour.cancelledAt)}`;
  const reason = !isCompleted && tour.cancelReason ? `<p class="muted">Motif : ${escapeHtml(tour.cancelReason)}</p>` : "";

  return `
    <section class="summary-panel">
      <p class="eyebrow">${isCompleted ? "Terminé" : "Arrêté"}</p>
      <h3>${title}</h3>
      <p class="muted">${subtitle}</p>
      ${reason}
      ${renderScanLog(tour)}
      <button class="primary-button" type="button" data-action="new-tour">Nouvelle tournée</button>
    </section>
  `;
}

function renderHistory() {
  if (!state.history.length) {
    return "";
  }

  const rows = state.history.slice(0, 3).map((tour) => {
    const label = tour.status === "completed" ? "Clôturée" : "Annulée";
    const endTime = tour.completedAt || tour.cancelledAt;
    return `
      <div class="scan-log-row">
        <strong>${label}</strong>
        <span>${formatTime(tour.startedAt)} - ${formatTime(endTime)}</span>
      </div>
    `;
  }).join("");

  return `
    <section class="summary-panel">
      <p class="eyebrow">Historique local</p>
      <div class="scan-log">${rows}</div>
    </section>
  `;
}

function renderScanLog(tour) {
  const rows = (tour.scans || []).map((scan) => `
    <div class="scan-log-row">
      <strong>${escapeHtml(scan.pointLabel)}</strong>
      <span>${formatTime(scan.scannedAt)}</span>
    </div>
  `).join("");

  return `<div class="scan-log">${rows}</div>`;
}

function openScanner() {
  state.scannerOpen = true;
  dom.scannerSheet.classList.add("is-open");
  dom.scannerSheet.setAttribute("aria-hidden", "false");
  dom.scannerTitle.textContent = getScannerTitle();
  dom.cameraState.textContent = "Caméra inactive";
  dom.manualCode.value = "";
  setTimeout(() => dom.manualCode.focus(), 120);
}

function closeScanner() {
  stopCamera();
  state.scannerOpen = false;
  dom.scannerSheet.classList.remove("is-open");
  dom.scannerSheet.setAttribute("aria-hidden", "true");
}

async function startCamera() {
  if (!("BarcodeDetector" in window)) {
    dom.cameraState.textContent = "Scanner caméra indisponible";
    showToast("Saisie manuelle disponible");
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    dom.cameraState.textContent = "Caméra indisponible";
    showToast("Saisie manuelle disponible");
    return;
  }

  try {
    scanner.detector = scanner.detector || new window.BarcodeDetector({ formats: ["qr_code"] });
    scanner.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" }
      },
      audio: false
    });
    dom.scannerVideo.srcObject = scanner.stream;
    await dom.scannerVideo.play();
    dom.cameraState.textContent = "Recherche QR...";
    scanFrame();
  } catch (error) {
    console.warn("Camera start failed:", error);
    dom.cameraState.textContent = "Caméra refusée";
    showToast("Saisie manuelle disponible");
  }
}

async function scanFrame() {
  if (!scanner.stream || !scanner.detector) {
    return;
  }

  try {
    const codes = await scanner.detector.detect(dom.scannerVideo);
    const firstCode = codes[0]?.rawValue;
    if (firstCode && !scanner.locked) {
      scanner.locked = true;
      handleScan(firstCode);
      window.setTimeout(() => {
        scanner.locked = false;
      }, 900);
      return;
    }
  } catch (error) {
    console.warn("QR detect failed:", error);
  }

  scanner.loopId = window.requestAnimationFrame(scanFrame);
}

function stopCamera() {
  if (scanner.loopId) {
    window.cancelAnimationFrame(scanner.loopId);
    scanner.loopId = null;
  }

  if (scanner.stream) {
    scanner.stream.getTracks().forEach((track) => track.stop());
    scanner.stream = null;
  }

  dom.scannerVideo.srcObject = null;
}

function handleScan(rawPayload) {
  if (!state.agent) {
    showToast("Connexion requise");
    closeScanner();
    return;
  }

  if (!state.activeTour) {
    const result = startTour(state.agent, rawPayload);
    if (!result.ok) {
      showToast(getReasonMessage(result.reason));
      return;
    }

    state.activeTour = result.tour;
    state.pendingStart = false;
    saveActiveTour(state.activeTour);
    closeScanner();
    showToast("Tournée démarrée");
    render();
    return;
  }

  const result = applyScan(state.activeTour, rawPayload);
  if (!result.ok) {
    showToast(getReasonMessage(result.reason));
    return;
  }

  state.activeTour = result.tour;

  if (result.completed) {
    addTourToHistory(result.tour);
    state.history = loadTourHistory();
    state.lastOutcomeTour = result.tour;
    state.activeTour = null;
    saveActiveTour(null);
    closeScanner();
    showToast("Tournée clôturée");
    render();
    return;
  }

  saveActiveTour(state.activeTour);
  closeScanner();
  showToast(result.readyToClose ? "Retour Poste A requis" : "Point validé");
  render();
}

function getScannerTitle() {
  if (!state.activeTour) {
    return "Scanner Poste A";
  }

  return getTourPhase(state.activeTour) === "awaiting_close" ? "Scanner retour Poste A" : "Scanner un point";
}

function openCancelSheet() {
  if (!state.activeTour) {
    return;
  }

  state.cancelOpen = true;
  state.selectedCancelReason = "";
  dom.cancelReason.value = "";
  dom.cancelSheet.classList.add("is-open");
  dom.cancelSheet.setAttribute("aria-hidden", "false");
  updateReasonButtons();
}

function closeCancelSheet() {
  state.cancelOpen = false;
  dom.cancelSheet.classList.remove("is-open");
  dom.cancelSheet.setAttribute("aria-hidden", "true");
}

function updateReasonButtons() {
  document.querySelectorAll("[data-reason]").forEach((button) => {
    button.classList.toggle("selected", button.dataset.reason === state.selectedCancelReason);
  });
}

function getReasonMessage(reason) {
  const messages = {
    missing_agent: "Connexion requise",
    unknown_qr: "QR code inconnu",
    start_requires_post: "Scannez Poste A pour démarrer",
    close_requires_all_checkpoints: "Validez les trois points avant retour",
    checkpoint_already_scanned: "Point déjà validé",
    tour_not_active: "Aucune tournée active",
    invalid_point: "Point non valide"
  };
  return messages[reason] || "Scan refusé";
}

function formatTime(isoValue) {
  if (!isoValue) {
    return "--:--";
  }

  return new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(isoValue));
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function showToast(message) {
  dom.toast.textContent = message;
  dom.toast.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    dom.toast.classList.remove("show");
  }, 1500);
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((error) => {
      console.warn("Service worker registration failed:", error);
    });
  });
}
