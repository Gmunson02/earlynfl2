// pages/api/scoreboard.js

// Tiny adaptive in-memory cache per (year-week-seasontype)
const cache = new Map(); // key -> { ts, ttl, data, hasLive }
const TTL_LIVE_MS = 20_000;  // 20s during live games
const TTL_IDLE_MS = 90_000;  // 90s when idle (pre/post)

export default async function handler(req, res) {
  try {
    const { year, week, seasontype } = req.query || {};
    if (!year || !week || !seasontype) {
      return res.status(400).json({ error: "Missing year/week/seasontype" });
    }

    const key = `${year}-${week}-${seasontype}`;
    const now = Date.now();

    // Serve from cache if fresh
    const hit = cache.get(key);
    if (hit && now - hit.ts < hit.ttl) {
      setCacheHeaders(res, hit.ttl);
      return res.status(200).json(hit.data);
    }

    // Bust upstream cache with timestamp and avoid intermediate caches
    const upstream = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard` +
      `?year=${encodeURIComponent(year)}` +
      `&week=${encodeURIComponent(week)}` +
      `&seasontype=${encodeURIComponent(seasontype)}` +
      `&_=${now}`;

    const rsp = await fetch(upstream, {
      cache: "no-store",
      headers: { "User-Agent": "earlynfl3" },
    });

    if (!rsp.ok) {
      return res.status(rsp.status).json({ error: `Upstream error ${rsp.status}` });
    }

    const data = await rsp.json();

    // Detect if any game is live
    const events = Array.isArray(data?.events) ? data.events : [];
    const hasLive = events.some(
      (e) => e?.competitions?.[0]?.status?.type?.state === "in"
    );

    // Choose TTL based on state
    const ttl = hasLive ? TTL_LIVE_MS : TTL_IDLE_MS;

    // Cache result
    cache.set(key, { ts: now, ttl, data, hasLive });

    // Cache headers for client/CDN to align with TTL
    setCacheHeaders(res, ttl);

    return res.status(200).json(data);
  } catch (err) {
    console.error("Scoreboard API error:", err);
    return res.status(500).json({ error: "Internal error" });
  }
}

/**
 * Align Cache-Control with the selected TTL so multiple clients share the same upstream fetch.
 */
function setCacheHeaders(res, ttlMs) {
  const seconds = Math.max(0, Math.floor(ttlMs / 1000));
  // Allow small public cache window + SWR to smooth spikes
  res.setHeader(
    "Cache-Control",
    `public, max-age=${seconds}, s-maxage=${seconds}, stale-while-revalidate=60`
  );
}
