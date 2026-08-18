import { fetchManagerTours } from "./remoteStore.js";
import { loadActiveTour, loadTourHistory } from "./storage.js";

const managerView = document.getElementById("managerView");

render();

async function render() {
  managerView.innerHTML = renderLoading();
  const remote = await fetchManagerTours();
  const tours = remote.ok ? normalizeRemoteTours(remote.tours) : loadLocalTours();

  managerView.innerHTML = `
    <section class="status-panel">
      <div class="status-top">
        <div>
          <p class="eyebrow">Supervision</p>
          <h2 class="status-title">Tournées</h2>
          <p class="status-copy">${remote.ok ? "Données Supabase" : "Mode local de démonstration"}</p>
        </div>
        <span class="status-pill ${remote.ok ? "" : "pending"}">${remote.ok ? "Connecté" : "Local"}</span>
      </div>
      ${renderStats(tours)}
    </section>
    <section class="manager-list">
      ${tours.length ? tours.map(renderTourCard).join("") : renderEmpty()}
    </section>
  `;
}

function renderLoading() {
  return `
    <section class="status-panel">
      <p class="eyebrow">Supervision</p>
      <h2 class="status-title">Chargement</h2>
      <p class="status-copy">Lecture des tournées...</p>
    </section>
  `;
}

function renderStats(tours) {
  const active = tours.filter((tour) => tour.status === "active").length;
  const completed = tours.filter((tour) => tour.status === "completed").length;
  const cancelled = tours.filter((tour) => tour.status === "cancelled").length;

  return `
    <div class="metric-strip">
      <div class="metric"><span>En cours</span><strong>${active}</strong></div>
      <div class="metric"><span>Terminées</span><strong>${completed}</strong></div>
      <div class="metric"><span>Annulées</span><strong>${cancelled}</strong></div>
    </div>
  `;
}

function renderTourCard(tour) {
  const statusLabel = {
    active: "En cours",
    completed: "Terminée",
    cancelled: "Annulée"
  }[tour.status] || tour.status;

  const endTime = tour.completedAt || tour.cancelledAt;
  const scans = tour.scans || [];

  return `
    <article class="manager-card">
      <div class="status-top">
        <div>
          <p class="eyebrow">${escapeHtml(tour.agentBadge || "Agent")}</p>
          <h3>${escapeHtml(tour.agentName || "Agent")}</h3>
          <p class="muted">${formatTime(tour.startedAt)}${endTime ? ` - ${formatTime(endTime)}` : ""}</p>
        </div>
        <span class="status-pill ${tour.status === "active" ? "pending" : ""}">${statusLabel}</span>
      </div>
      ${tour.cancelReason ? `<p class="muted">Motif : ${escapeHtml(tour.cancelReason)}</p>` : ""}
      ${tour.comment ? `<p class="muted">Commentaire : ${escapeHtml(tour.comment)}</p>` : ""}
      <div class="scan-log">
        ${scans.length ? scans.map(renderScanRow).join("") : `<p class="muted">Aucun scan enregistré.</p>`}
      </div>
    </article>
  `;
}

function renderScanRow(scan) {
  return `
    <div class="scan-log-row">
      <strong>${escapeHtml(scan.pointLabel)}</strong>
      <span>${formatTime(scan.scannedAt)}</span>
    </div>
  `;
}

function renderEmpty() {
  return `
    <article class="summary-panel">
      <p class="eyebrow">Aucune donnée</p>
      <h3>Pas encore de tournée</h3>
      <p class="muted">Les tournées apparaîtront ici après les premiers scans envoyés.</p>
    </article>
  `;
}

function normalizeRemoteTours(rows) {
  return (rows || []).map((row) => ({
    id: row.id,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
    cancelReason: row.cancel_reason,
    comment: row.comment || "",
    agentName: row.agent_name,
    agentBadge: row.agent_badge,
    scans: (row.tour_scans || [])
      .map((scan) => ({
        id: scan.id,
        pointLabel: scan.point_label,
        type: scan.scan_type,
        scannedAt: scan.scanned_at
      }))
      .sort((a, b) => new Date(a.scannedAt) - new Date(b.scannedAt))
  }));
}

function loadLocalTours() {
  const activeTour = loadActiveTour();
  const history = loadTourHistory();
  return activeTour ? [activeTour, ...history] : history;
}

function formatTime(isoValue) {
  if (!isoValue) {
    return "--:--";
  }

  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
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
