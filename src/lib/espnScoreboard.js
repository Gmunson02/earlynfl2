// lib/espnScoreboard.js
// Shared server-side cache for ESPN scoreboard data, used by both the
// /api/scoreboard proxy and picks.jsx's getServerSideProps, so simultaneous
// requests for the same week don't each hit ESPN separately.

const cache = new Map(); // key -> { ts, ttl, data, hasLive }
const TTL_LIVE_MS = 20_000; // 20s during live games
const TTL_IDLE_MS = 90_000; // 90s when idle (pre/post)

export async function getScoreboard({ year, week, seasontype }) {
  const key = `${year}-${week}-${seasontype}`;
  const now = Date.now();

  const hit = cache.get(key);
  if (hit && now - hit.ts < hit.ttl) {
    return { data: hit.data, ttlMs: hit.ttl, fromCache: true };
  }

  const upstream =
    `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard` +
    `?year=${encodeURIComponent(year)}` +
    `&week=${encodeURIComponent(week)}` +
    `&seasontype=${encodeURIComponent(seasontype)}` +
    `&_=${now}`;

  const rsp = await fetch(upstream, {
    cache: "no-store",
    headers: { "User-Agent": "earlynfl3" },
  });
  if (!rsp.ok) {
    throw new Error(`Upstream error ${rsp.status}`);
  }

  const data = await rsp.json();
  const events = Array.isArray(data?.events) ? data.events : [];
  const hasLive = events.some((e) => e?.competitions?.[0]?.status?.type?.state === "in");
  const ttl = hasLive ? TTL_LIVE_MS : TTL_IDLE_MS;

  cache.set(key, { ts: now, ttl, data, hasLive });

  return { data, ttlMs: ttl, fromCache: false };
}
