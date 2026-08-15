// lib/seasonStandings.js
import { db } from "./firebase";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";

// Loads a full season's standings, summed by display name so a person's
// fragmented guest accounts (same name, different uids) count as one entry.
export async function loadSeasonStandingsByName(year, season) {
  const seasonId = `${year}-${season}`;
  const [seasonSnap, weeklySnap] = await Promise.all([
    getDoc(doc(db, "season_leaderboard", seasonId)),
    getDocs(query(collection(db, "weekly_results"), where("year", "==", year), where("season", "==", season))),
  ]);
  if (!seasonSnap.exists()) return [];
  const players = seasonSnap.data().players || {};

  const titleWins = {};
  weeklySnap.forEach((d) => {
    (d.data().winners || []).forEach((w) => {
      const uid = typeof w === "string" ? w : w?.uid;
      if (uid) titleWins[uid] = (titleWins[uid] || 0) + 1;
    });
  });

  const byName = new Map();
  for (const [uid, p] of Object.entries(players)) {
    const name = (p.displayName || uid).trim();
    const wins = titleWins[uid] || 0;
    const points = p.totalCorrectPicks || 0;
    const existing = byName.get(name) || { name, wins: 0, points: 0 };
    existing.wins += wins;
    existing.points += points;
    byName.set(name, existing);
  }

  const merged = Array.from(byName.values());
  merged.sort((a, b) => b.wins - a.wins || b.points - a.points || a.name.localeCompare(b.name));

  let lastKey = null;
  let rank = 0;
  let place = 0;
  return merged.map((r) => {
    place += 1;
    const key = `${r.wins}|${r.points}`;
    if (key !== lastKey) {
      rank = place;
      lastKey = key;
    }
    return { ...r, rank };
  });
}
