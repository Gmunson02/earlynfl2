// lib/espnSummary.js
// Shared server-side cache for ESPN's per-game summary endpoint (linescore,
// scoring plays, team stats) — separate from the scoreboard list endpoint.

const cache = new Map(); // eventId -> { ts, ttl, data }
const TTL_MS = 20_000; // matches the live scoreboard TTL

export async function getGameSummary(eventId) {
  const now = Date.now();
  const hit = cache.get(eventId);
  if (hit && now - hit.ts < hit.ttl) {
    return hit.data;
  }

  const upstream = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${encodeURIComponent(eventId)}`;
  const rsp = await fetch(upstream, { cache: "no-store", headers: { "User-Agent": "earlynfl3" } });
  if (!rsp.ok) throw new Error(`Upstream error ${rsp.status}`);

  const data = await rsp.json();
  cache.set(eventId, { ts: now, ttl: TTL_MS, data });
  return data;
}
