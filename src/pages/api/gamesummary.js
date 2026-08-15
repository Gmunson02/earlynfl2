// pages/api/gamesummary.js
import { getGameSummary } from "../../lib/espnSummary";

export default async function handler(req, res) {
  try {
    const { event } = req.query || {};
    if (!event) {
      return res.status(400).json({ error: "Missing event" });
    }

    const data = await getGameSummary(String(event));
    res.setHeader("Cache-Control", "public, max-age=20, s-maxage=20, stale-while-revalidate=60");
    return res.status(200).json(data);
  } catch (err) {
    console.error("Game summary API error:", err);
    return res.status(500).json({ error: "Internal error" });
  }
}
