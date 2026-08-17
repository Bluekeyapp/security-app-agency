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
import { saveTourRemote } from "./remoteStore.js";

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
  zxingModule: null,
  zxingReader: null,
  zxingControls: null,
  stream: null,
  loopId: null,
  locked: false,
  starting: false
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
  cancelSheet: document.getElementById("cancelSheet"),
  closeCancelButton: document.getElementById("closeCancelButton"),
  cancelReason: document.getElementById("cancelReason"),
  confirmCancelButton: document.getElementById("confirmCancelButton")
};

let toastTimer = null;

const QR_SCAN_OPTIONS = {
  delayBetweenScanAttempts: 120,
  delayBetweenScanSuccess: 500,
  tryPlayVideoTimeout: 3000
};

setupViewportHeight();
bindEvents();
render();
registerServiceWorker();

function setupViewportHeight() {
  const update = () => {
    const viewportHeight = window.visualViewport?.height || window.innerHeight;
    document.documentElement.style.setProperty("--app-height", `${Math.round(viewportHeight)}px`);
  };

  update();
  window.addEventListener("resize", update);
  window.addEventListener("orientationchange", () => window.setTimeout(update, 120));
  window.visualViewport?.addEventListener("resize", update);
  window.visualViewport?.addEventListener("scroll", update);
}

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
    }

    if (action === "scan") {
      openScanner();
    }

    if (action === "cancel-start") {
      state.pendingStart = false;
      render();
    }

    if (action === "cancel") {
      openCancelSheet();
    }

  });

  dom.closeScannerButton.addEventListener("click", closeScanner);
  dom.startCameraButton.addEventListener("click", startCamera);

  dom.scannerSheet.addEventListener("click", (event) => {
    if (event.target === dom.scannerSheet) {
      closeScanner();
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
    persistTour(cancelled);
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
        <button class="primary-button" type="button" data-action="start">Nouvelle tournée</button>
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
      </section>
      <div class="dock">
        <div class="two-actions">
          <button class="secondary-button" type="button" data-action="cancel-start">Annuler</button>
          <button class="primary-button" type="button" data-action="scan">Scanner</button>
        </div>
      </div>
      ${renderPointRows(null)}
    </div>
  `;
}

function renderActiveTour(tour) {
  const checkpointCount = getScannedCheckpointIds(tour).size;
  const phase = getTourPhase(tour);
  const readyToClose = phase === "awaiting_close";
  const remainingCount = CHECKPOINT_IDS.length - checkpointCount;
  const nextTitle = readyToClose ? "Retour Poste A" : "Points de contrôle";
  const nextCopy = readyToClose
    ? "Les trois points sont validés. Scannez le Poste A pour clôturer."
    : `${remainingCount} point${remainingCount > 1 ? "s" : ""} à scanner. Appuyez sur Nouveau scan à chaque point.`;
  const primaryLabel = readyToClose ? "Clôturer au Poste A" : "Nouveau scan";

  return `
    <div class="stack">
      <section class="status-panel">
        <div class="status-top">
          <div>
            <p class="eyebrow">Tournée active</p>
            <h2 class="status-title">${nextTitle}</h2>
            <p class="status-copy">${nextCopy}</p>
          </div>
          <span class="status-pill ${readyToClose ? "" : "pending"}">${readyToClose ? "À clôturer" : `${checkpointCount}/3`}</span>
        </div>
        <div class="metric-strip">
          <div class="metric"><span>Départ</span><strong>${formatTime(tour.startedAt)}</strong></div>
          <div class="metric"><span>Validés</span><strong>${checkpointCount}/3</strong></div>
          <div class="metric"><span>Agent</span><strong>${escapeHtml(tour.agentBadge)}</strong></div>
        </div>
      </section>
      <div class="dock">
        <p class="dock-hint">${readyToClose ? "Dernière étape : retour au Poste A." : "Quand vous arrivez au prochain point, lancez la caméra."}</p>
        <button class="primary-button" type="button" data-action="scan">${primaryLabel}</button>
        <button class="secondary-button" type="button" data-action="cancel">Annuler</button>
      </div>
      ${renderPointRows(tour)}
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
  dom.cameraState.textContent = "Ouverture caméra...";
  dom.startCameraButton.hidden = false;
  dom.startCameraButton.disabled = true;
  dom.startCameraButton.textContent = "Ouverture caméra...";
  startCamera();
}

function closeScanner() {
  stopCamera();
  state.scannerOpen = false;
  dom.scannerSheet.classList.remove("is-open");
  dom.scannerSheet.setAttribute("aria-hidden", "true");
}

async function startCamera() {
  if (scanner.starting || scanner.stream || scanner.zxingControls) {
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    dom.cameraState.textContent = "Caméra indisponible";
    dom.startCameraButton.hidden = false;
    dom.startCameraButton.disabled = false;
    dom.startCameraButton.textContent = "Réessayer la caméra";
    showToast("Scanner caméra requis");
    return;
  }

  scanner.starting = true;
  dom.startCameraButton.disabled = true;
  dom.startCameraButton.textContent = "Ouverture caméra...";

  try {
    if ("BarcodeDetector" in window) {
      await startNativeScanner();
      markCameraStarted();
      return;
    }

    const zxingModule = await loadZxingModule();
    if (zxingModule?.BrowserQRCodeReader) {
      await startZxingScanner(zxingModule);
      markCameraStarted();
      return;
    }

    dom.cameraState.textContent = "Scanner QR indisponible";
    dom.startCameraButton.hidden = false;
    dom.startCameraButton.disabled = false;
    dom.startCameraButton.textContent = "Réessayer la caméra";
    showToast("Navigateur non compatible");
  } catch (error) {
    console.warn("Camera start failed:", error);
    dom.cameraState.textContent = getCameraErrorMessage(error);
    dom.startCameraButton.hidden = false;
    dom.startCameraButton.disabled = false;
    dom.startCameraButton.textContent = "Réessayer la caméra";
    showToast("Scanner caméra requis");
  } finally {
    scanner.starting = false;
  }
}

function markCameraStarted() {
  dom.startCameraButton.hidden = true;
  dom.startCameraButton.disabled = false;
  dom.startCameraButton.textContent = "Réessayer la caméra";
}

function getCameraConstraints() {
  return {
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30, max: 30 }
    },
    audio: false
  };
}

async function applyCameraOptimizations(stream) {
  const track = stream?.getVideoTracks?.()[0];
  if (!track?.getCapabilities || !track.applyConstraints) {
    return;
  }

  try {
    const capabilities = track.getCapabilities();
    if (capabilities.focusMode?.includes("continuous")) {
      await track.applyConstraints({
        advanced: [{ focusMode: "continuous" }]
      });
    }
  } catch (error) {
    console.warn("Camera optimization skipped:", error);
  }
}

async function applyZxingCameraOptimizations(controls) {
  try {
    await controls?.streamVideoConstraintsApply?.({
      advanced: [{ focusMode: "continuous" }]
    });
  } catch (error) {
    console.warn("Camera optimization skipped:", error);
  }
}

async function loadZxingModule() {
  if (scanner.zxingModule) {
    return scanner.zxingModule;
  }

  scanner.zxingModule = await import("https://esm.sh/@zxing/browser@0.1.5");
  return scanner.zxingModule;
}

async function startNativeScanner() {
  scanner.detector = scanner.detector || new window.BarcodeDetector({ formats: ["qr_code"] });
  scanner.stream = await navigator.mediaDevices.getUserMedia(getCameraConstraints());
  await applyCameraOptimizations(scanner.stream);
  dom.scannerVideo.srcObject = scanner.stream;
  await dom.scannerVideo.play();
  dom.cameraState.textContent = "Recherche QR... rapprochez le code du cadre";
  scanFrame();
}

async function startZxingScanner(zxingModule) {
  scanner.zxingReader = scanner.zxingReader || new zxingModule.BrowserQRCodeReader(undefined, QR_SCAN_OPTIONS);
  scanner.zxingControls = await scanner.zxingReader.decodeFromConstraints(
    getCameraConstraints(),
    dom.scannerVideo,
    (result, error) => {
      if (result && !scanner.locked) {
        scanner.locked = true;
        handleScan(result.getText());
        window.setTimeout(() => {
          scanner.locked = false;
        }, 900);
        return;
      }

      if (error?.name && error.name !== "NotFoundException") {
        console.warn("QR detect failed:", error);
      }
    }
  );
  await applyZxingCameraOptimizations(scanner.zxingControls);
  dom.cameraState.textContent = "Recherche QR... rapprochez le code du cadre";
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
  if (scanner.zxingControls) {
    scanner.zxingControls.stop();
    scanner.zxingControls = null;
  }

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
    persistTour(state.activeTour);
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
    persistTour(result.tour);
    closeScanner();
    showToast("Tournée clôturée");
    render();
    return;
  }

  persistTour(state.activeTour);
  closeScanner();
  showToast(result.readyToClose ? "Retour Poste A requis" : "Point validé");
  render();
}

function persistTour(tour) {
  saveActiveTour(tour?.status === "active" ? tour : null);
  saveTourRemote(tour).then((result) => {
    if (result.ok || result.skipped) {
      return;
    }

    console.warn("Remote tour save failed:", result.error);
    showToast("Synchro différée");
  });
}

function getScannerTitle() {
  if (!state.activeTour) {
    return "Scanner Poste A";
  }

  return getTourPhase(state.activeTour) === "awaiting_close" ? "Scanner retour Poste A" : "Scanner un point";
}

function getCameraErrorMessage(error) {
  if (error?.name === "NotAllowedError" || error?.name === "SecurityError") {
    return "Autorisation caméra refusée";
  }

  if (error?.name === "NotFoundError" || error?.name === "OverconstrainedError") {
    return "Aucune caméra disponible";
  }

  return "Caméra indisponible";
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
