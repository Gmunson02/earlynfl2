// pages/api/scoreboard.js
import { getScoreboard } from "../../lib/espnScoreboard";

export default async function handler(req, res) {
  try {
    const { year, week, seasontype } = req.query || {};
    if (!year || !week || !seasontype) {
      return res.status(400).json({ error: "Missing year/week/seasontype" });
    }

    const { data, ttlMs } = await getScoreboard({ year, week, seasontype });
    setCacheHeaders(res, ttlMs);
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
