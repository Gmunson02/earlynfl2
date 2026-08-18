// lib/weekLabels.js
// Server-side lookup of a week's house label (e.g. "Preseason Week 2") from
// schedules/{seasonId}/weeks, so a page can render the correct heading in its
// very first paint. Without this the heading falls back to the route's week
// param — which is ESPN's own week number, not ours (Preseason Week 2 is
// ESPN week 3), so the title visibly changed a beat after load.
//
// schedules is world-readable (see firestore.rules), so this uses the plain
// REST endpoint with the public web API key — no Admin SDK needed.

const cache = new Map(); // seasonId -> { ts, weeks }
const TTL_MS = 10 * 60 * 1000; // the schedule is static within a season

function readField(f) {
  if (!f) return null;
  return f.stringValue ?? f.integerValue ?? f.doubleValue ?? null;
}

async function loadWeeks(seasonId) {
  const hit = cache.get(seasonId);
  if (hit && Date.now() - hit.ts < TTL_MS) return hit.weeks;

  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!projectId || !apiKey) return [];

  const url =
    `https://firestore.googleapis.com/v1/projects/${projectId}` +
    `/databases/(default)/documents/schedules/${encodeURIComponent(seasonId)}/weeks` +
    `?pageSize=100&key=${encodeURIComponent(apiKey)}`;

  const rsp = await fetch(url, { cache: "no-store" });
  if (!rsp.ok) return []; // don't cache failures — try again next request

  const json = await rsp.json();
  const weeks = (json.documents || []).map((d) => ({
    seasonType: readField(d.fields?.seasonType),
    value: readField(d.fields?.value),
    label: readField(d.fields?.label),
  }));

  cache.set(seasonId, { ts: Date.now(), weeks });
  return weeks;
}

export async function getWeekLabel({ year, season, week }) {
  try {
    const weeks = await loadWeeks(`nfl-${year}`);
    const match = weeks.find(
      (w) => w.seasonType === String(season) && String(w.value) === String(week)
    );
    return match?.label || null;
  } catch {
    return null; // the client-side hook still fills it in
  }
}
