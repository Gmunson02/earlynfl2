// pages/api/scoreboard.js
// Tiny in-memory cache per (year-week-seasontype)
const cache = new Map(); // key -> { ts, data }
const TTL_MS = 15_000;

export default async function handler(req, res) {
  const { year, week, seasontype } = req.query || {};
  if (!year || !week || !seasontype) {
    return res.status(400).json({ error: "Missing year/week/seasontype" });
  }

  const key = `${year}-${week}-${seasontype}`;
  const now = Date.now();

  const hit = cache.get(key);
  if (hit && now - hit.ts < TTL_MS) {
    // Cache headers also help CDN/proxy layers
    res.setHeader("Cache-Control", "public, max-age=5, s-maxage=5, stale-while-revalidate=60");
    return res.status(200).json(hit.data);
  }

  const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?year=${year}&week=${week}&seasontype=${seasontype}`;
  const rsp = await fetch(url, { headers: { "User-Agent": "earlynfl3" } });
  if (!rsp.ok) {
    return res.status(rsp.status).json({ error: `Upstream error ${rsp.status}` });
  }
  const data = await rsp.json();
  cache.set(key, { ts: now, data });

  res.setHeader("Cache-Control", "public, max-age=5, s-maxage=5, stale-while-revalidate=60");
  res.status(200).json(data);
}
