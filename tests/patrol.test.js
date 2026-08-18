import test from "node:test";
import assert from "node:assert/strict";

import {
  applyScan,
  cancelTour,
  createAgent,
  getScannedCheckpointIds,
  getTourPhase,
  resolvePointId,
  setTourComment,
  startTour
} from "../src/patrol.js";

const agent = createAgent({ name: "Nadia Karim", badge: "AG-42" });

test("createAgent requires a name and badge", () => {
  assert.equal(createAgent({ name: "", badge: "A1" }), null);
  assert.equal(createAgent({ name: "Agent", badge: "" }), null);
  assert.deepEqual(agent, {
    id: "agent-ag42",
    name: "Nadia Karim",
    badge: "AG-42"
  });
});

test("QR payloads resolve from plain text, URL and JSON", () => {
  assert.equal(resolvePointId("POST_A"), "post-a");
  assert.equal(resolvePointId("https://agency.test/scan?point=CP_2"), "checkpoint-2");
  assert.equal(resolvePointId(JSON.stringify({ pointId: "CP_3" })), "checkpoint-3");
});

test("a tour can only start from Poste A", () => {
  assert.equal(startTour(agent, "CP_1").reason, "start_requires_post");

  const result = startTour(agent, "POST_A", "2026-08-17T10:00:00Z");
  assert.equal(result.ok, true);
  assert.equal(result.tour.status, "active");
  assert.equal(result.scan.agentId, agent.id);
  assert.equal(result.scan.pointId, "post-a");
  assert.equal(result.scan.scannedAt, "2026-08-17T10:00:00.000Z");
});

test("checkpoints can be scanned in any order and cannot be duplicated", () => {
  let tour = startTour(agent, "POST_A", "2026-08-17T10:00:00Z").tour;

  let result = applyScan(tour, "CP_3", "2026-08-17T10:02:00Z");
  assert.equal(result.ok, true);
  tour = result.tour;

  result = applyScan(tour, "CP_1", "2026-08-17T10:04:00Z");
  assert.equal(result.ok, true);
  tour = result.tour;

  result = applyScan(tour, "CP_3", "2026-08-17T10:05:00Z");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "checkpoint_already_scanned");

  assert.deepEqual([...getScannedCheckpointIds(tour)].sort(), ["checkpoint-1", "checkpoint-3"]);
});

test("closing at Poste A requires all three checkpoints", () => {
  let tour = startTour(agent, "POST_A", "2026-08-17T10:00:00Z").tour;
  tour = applyScan(tour, "CP_2", "2026-08-17T10:03:00Z").tour;

  let result = applyScan(tour, "POST_A", "2026-08-17T10:08:00Z");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "close_requires_all_checkpoints");

  tour = applyScan(tour, "CP_1", "2026-08-17T10:10:00Z").tour;
  tour = applyScan(tour, "CP_3", "2026-08-17T10:12:00Z").tour;
  assert.equal(getTourPhase(tour), "awaiting_close");

  result = applyScan(tour, "POST_A", "2026-08-17T10:15:00Z");
  assert.equal(result.ok, true);
  assert.equal(result.completed, true);
  assert.equal(result.tour.status, "completed");
  assert.equal(result.scan.type, "close");
  assert.equal(result.scan.agentId, agent.id);
  assert.equal(result.scan.pointId, "post-a");
});

test("a tour can be cancelled with an optional reason", () => {
  const tour = startTour(agent, "POST_A", "2026-08-17T10:00:00Z").tour;
  const cancelled = cancelTour(tour, "Incident", "2026-08-17T10:05:00Z");

  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.cancelReason, "Incident");
  assert.equal(cancelled.cancelledAt, "2026-08-17T10:05:00.000Z");
});

test("a tour can receive a sanitized comment", () => {
  const tour = startTour(agent, "POST_A", "2026-08-17T10:00:00Z").tour;
  const commented = setTourComment(tour, "  Porte arrière vérifiée.  ");

  assert.equal(commented.comment, "Porte arrière vérifiée.");
  assert.equal(commented.id, tour.id);
});
