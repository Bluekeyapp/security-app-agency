import { getSupabaseClient } from "./supabaseClient.js";

const DEFAULT_SITE_ID = "00000000-0000-0000-0000-000000000001";

export async function saveTourRemote(tour) {
  const supabase = await getSupabaseClient();
  if (!supabase || !tour) {
    return { ok: false, skipped: true };
  }

  const agentRow = {
    id: tour.agentId,
    name: tour.agentName,
    badge: tour.agentBadge,
    active: true
  };

  const tourRow = {
    id: tour.id,
    site_id: DEFAULT_SITE_ID,
    agent_id: tour.agentId,
    agent_name: tour.agentName,
    agent_badge: tour.agentBadge,
    status: tour.status,
    started_at: tour.startedAt,
    completed_at: tour.completedAt,
    cancelled_at: tour.cancelledAt,
    cancel_reason: tour.cancelReason || "",
    updated_at: new Date().toISOString()
  };

  const scanRows = (tour.scans || []).map((scan) => ({
    id: scan.id,
    tour_id: scan.tourId,
    agent_id: scan.agentId,
    checkpoint_id: scan.pointId,
    point_label: scan.pointLabel,
    scan_type: scan.type,
    scanned_at: scan.scannedAt,
    source_payload: scan.sourcePayload,
    gps_lat: scan.gps?.lat || null,
    gps_lng: scan.gps?.lng || null,
    gps_accuracy: scan.gps?.accuracy || null
  }));

  const agentResult = await supabase
    .from("agents")
    .upsert(agentRow, { onConflict: "id", ignoreDuplicates: true });
  if (agentResult.error) {
    return { ok: false, error: agentResult.error };
  }

  const tourResult = await supabase.from("tours").upsert(tourRow);
  if (tourResult.error) {
    return { ok: false, error: tourResult.error };
  }

  if (scanRows.length) {
    const scansResult = await supabase
      .from("tour_scans")
      .upsert(scanRows, { onConflict: "id", ignoreDuplicates: true });
    if (scansResult.error) {
      return { ok: false, error: scansResult.error };
    }
  }

  return { ok: true };
}

export async function fetchManagerTours() {
  const supabase = await getSupabaseClient();
  if (!supabase) {
    return { ok: false, skipped: true, tours: [] };
  }

  const { data, error } = await supabase
    .from("tours")
    .select(`
      id,
      status,
      started_at,
      completed_at,
      cancelled_at,
      cancel_reason,
      agent_name,
      agent_badge,
      tour_scans (
        id,
        point_label,
        scan_type,
        scanned_at
      )
    `)
    .order("started_at", { ascending: false })
    .limit(50);

  if (error) {
    return { ok: false, error, tours: [] };
  }

  return { ok: true, tours: data || [] };
}
