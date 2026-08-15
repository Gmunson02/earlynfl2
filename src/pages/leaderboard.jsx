import { useEffect, useMemo, useState } from "react";
import Head from "next/head";
import { db } from "../lib/firebase";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";

const CURRENT_YEAR = 2026;
const CURRENT_SEASON = "reg"; // standings only count regular season

const LAST_YEAR = 2025;
const LAST_SEASON = "reg";

async function loadSeasonWinner(year, season) {
  const seasonId = `${year}-${season}`;
  const seasonSnap = await getDoc(doc(db, "season_leaderboard", seasonId));
  if (!seasonSnap.exists()) return null;
  const players = seasonSnap.data().players || {};

  const weeklySnap = await getDocs(
    query(collection(db, "weekly_results"), where("year", "==", year), where("season", "==", season))
  );
  const titleWins = {};
  weeklySnap.forEach((d) => {
    (d.data().winners || []).forEach((w) => {
      const uid = typeof w === "string" ? w : w?.uid;
      if (uid) titleWins[uid] = (titleWins[uid] || 0) + 1;
    });
  });

  const ranked = Object.entries(players)
    .map(([uid, p]) => ({
      uid,
      name: p.displayName || uid,
      wins: titleWins[uid] || 0,
      points: p.totalCorrectPicks || 0,
    }))
    .sort((a, b) => b.wins - a.wins || b.points - a.points);

  return ranked[0] || null;
}

export default function LeaderboardPage() {
  const [loading, setLoading] = useState(true);
  const [seasonDoc, setSeasonDoc] = useState(null);
  const [weeklyDocs, setWeeklyDocs] = useState([]);
  const [latestWeekly, setLatestWeekly] = useState(null);
  const [lastSeasonWinner, setLastSeasonWinner] = useState(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);

      const sSnap = await getDoc(doc(db, "season_leaderboard", `${CURRENT_YEAR}-${CURRENT_SEASON}`));
      const season = sSnap.exists() ? { id: sSnap.id, ...sSnap.data() } : null;

      const wSnap = await getDocs(
        query(
          collection(db, "weekly_results"),
          where("year", "==", CURRENT_YEAR),
          where("season", "==", CURRENT_SEASON)
        )
      );
      const weeklies = [];
      wSnap.forEach((d) => weeklies.push({ id: d.id, ...d.data() }));
      weeklies.sort((a, b) => (b.week || 0) - (a.week || 0));

      const lastWinner = await loadSeasonWinner(LAST_YEAR, LAST_SEASON);

      setSeasonDoc(season);
      setWeeklyDocs(weeklies);
      setLatestWeekly(weeklies[0] || null);
      setLastSeasonWinner(lastWinner);
      setLoading(false);
    };
    load();
  }, []);

  // Map uid -> number of weekly titles (Wins), current season
  const weeklyWinsMap = useMemo(() => {
    const map = new Map();
    for (const w of weeklyDocs) {
      const winners = Array.isArray(w.winners) ? w.winners : [];
      for (const entry of winners) {
        const uid = typeof entry === "string" ? entry : entry?.uid;
        if (!uid) continue;
        map.set(uid, (map.get(uid) || 0) + 1);
      }
    }
    return map;
  }, [weeklyDocs]);

  // Normalize latest week's winners to [{ uid, displayName, correctPicks, tieBreaker }]
  const latestWinners = useMemo(() => {
    if (!latestWeekly?.winners) return [];
    const standings = Array.isArray(latestWeekly.standings) ? latestWeekly.standings : [];
    const getStand = (uid) => standings.find((s) => s.uid === uid) || null;

    return latestWeekly.winners.map((w) => {
      const uid = typeof w === "string" ? w : w.uid;
      const s = getStand(uid);
      return {
        uid,
        displayName: (typeof w === "string" ? null : w.displayName) || s?.displayName || uid,
        correctPicks: s?.wins ?? null,
        tieBreaker: s?.tieBreaker ?? null,
      };
    });
  }, [latestWeekly]);

  // Current season standings (Rank, Name, Wins, Points)
  const rows = useMemo(() => {
    const players = seasonDoc?.players || {};
    const merged = Object.entries(players).map(([uid, p]) => ({
      uid,
      name: p.displayName || uid,
      wins: weeklyWinsMap.get(uid) || 0,
      points: p.totalCorrectPicks || 0,
    }));

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
  }, [seasonDoc, weeklyWinsMap]);

  // Last week's full standings, de-duplicated by display name (guest accounts fragment real people)
  const lastWeekDeduped = useMemo(() => {
    if (!latestWeekly?.standings) return [];
    const byName = new Map();
    for (const s of latestWeekly.standings) {
      const name = (s.displayName || s.uid || "Unknown").trim();
      const existing = byName.get(name);
      if (!existing || (s.wins || 0) > (existing.wins || 0)) byName.set(name, s);
    }
    const list = Array.from(byName.values()).sort((a, b) => (b.wins || 0) - (a.wins || 0));

    let lastKey = null;
    let rank = 0;
    let place = 0;
    return list.map((s) => {
      place += 1;
      const key = String(s.wins || 0);
      if (key !== lastKey) {
        rank = place;
        lastKey = key;
      }
      return { ...s, rank };
    });
  }, [latestWeekly]);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-900 text-zinc-900 dark:text-white px-4 py-6">
      <Head>
        <title>Leaderboard • {CURRENT_YEAR} {CURRENT_SEASON.toUpperCase()}</title>
      </Head>

      <div className="max-w-5xl mx-auto space-y-6">
        <header className="flex items-baseline justify-between">
          <h1 className="text-3xl font-extrabold">Leaderboard</h1>
        </header>

        {/* Last Week's Winner(s) */}
        <section className="bg-white dark:bg-zinc-800/70 rounded-xl border border-zinc-200 dark:border-zinc-700 p-5">
          <h2 className="text-xl font-bold mb-3">Last Week&apos;s Winner(s)</h2>

          {loading ? (
            <p className="text-zinc-500">Loading…</p>
          ) : !latestWeekly ? (
            <p className="text-zinc-500">No computed week yet.</p>
          ) : latestWinners.length ? (
            <div className="space-y-2">
              {latestWinners.map((w) => (
                <div
                  key={w.uid}
                  className="rounded-lg border border-amber-300/60 dark:border-amber-400/30 bg-gradient-to-r from-amber-50 to-pink-50 dark:from-amber-900/20 dark:to-pink-900/20 px-3 py-2"
                >
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-lg">🎉</span>
                    <span className="font-bold text-base">{w.displayName}</span>
                    <span className="text-sm text-zinc-600 dark:text-zinc-300">
                      • Correct Picks:&nbsp;
                      <span className="font-semibold text-emerald-700 dark:text-emerald-300">
                        {w.correctPicks ?? "—"}
                      </span>
                    </span>
                    <span className="text-sm text-zinc-600 dark:text-zinc-300">
                      • Tiebreaker:&nbsp;
                      <span className="font-semibold">{w.tieBreaker ?? "—"}</span>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <span className="text-zinc-500">—</span>
          )}
        </section>

        {/* Last Season's Winner (2025) */}
        <section className="bg-white dark:bg-zinc-800/70 rounded-xl border border-zinc-200 dark:border-zinc-700 p-5">
          <h2 className="text-xl font-bold mb-3">
            Last Season&apos;s Winner ({LAST_YEAR})
          </h2>

          {loading ? (
            <p className="text-zinc-500">Loading…</p>
          ) : !lastSeasonWinner ? (
            <p className="text-zinc-500">No data for {LAST_YEAR}.</p>
          ) : (
            <div className="rounded-lg border border-amber-300/60 dark:border-amber-400/30 bg-gradient-to-r from-amber-50 to-pink-50 dark:from-amber-900/20 dark:to-pink-900/20 px-3 py-2">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-lg">🏆</span>
                <span className="font-bold text-base">{lastSeasonWinner.name}</span>
                <span className="text-sm text-zinc-600 dark:text-zinc-300">
                  • Total Wins:&nbsp;
                  <span className="font-semibold text-emerald-700 dark:text-emerald-300">
                    {lastSeasonWinner.wins}
                  </span>
                </span>
                <span className="text-sm text-zinc-600 dark:text-zinc-300">
                  • Points:&nbsp;
                  <span className="font-semibold">{lastSeasonWinner.points}</span>
                </span>
              </div>
            </div>
          )}
        </section>

        {/* Current season standings */}
        <section className="bg-white dark:bg-zinc-800/70 rounded-xl border border-zinc-200 dark:border-zinc-700 p-5">
          <h2 className="text-xl font-bold mb-3">
            {CURRENT_YEAR} Season Standings
          </h2>

          {loading ? (
            <p className="text-zinc-500">Loading…</p>
          ) : !rows.length ? (
            <p className="text-zinc-500">No players yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-max w-full text-sm">
                <thead className="bg-blue-600 text-white">
                  <tr>
                    <th className="text-left px-3 py-2 w-[48px]">#</th>
                    <th className="text-left px-3 py-2">User Name</th>
                    <th className="text-right px-3 py-2 sm:hidden w-[110px]">Wins • Pts</th>
                    <th className="hidden sm:table-cell text-right px-3 py-2 w-[72px]">
                      <span className="sm:hidden">W</span><span className="hidden sm:inline">Wins</span>
                    </th>
                    <th className="hidden sm:table-cell text-right px-3 py-2 w-[72px]">
                      <span className="sm:hidden">Pts</span><span className="hidden sm:inline">Points</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, idx) => (
                    <tr
                      key={r.uid}
                      className={idx % 2 ? "bg-zinc-50 dark:bg-zinc-900/60" : "bg-white dark:bg-zinc-800/60"}
                    >
                      <td className="px-3 py-2 font-medium">{r.rank}</td>
                      <td className="px-3 py-2 font-semibold">{r.name}</td>
                      <td className="sm:hidden px-3 py-2 text-right">
                        {r.wins} • {r.points}
                      </td>
                      <td className="hidden sm:table-cell px-3 py-2 text-right">{r.wins}</td>
                      <td className="hidden sm:table-cell px-3 py-2 text-right">{r.points}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Last week's full standings, collapsible, de-duped by name */}
        {!loading && lastWeekDeduped.length > 0 && (
          <details className="bg-white dark:bg-zinc-800/70 rounded-xl border border-zinc-200 dark:border-zinc-700 p-5">
            <summary className="text-xl font-bold cursor-pointer select-none">
              Last Week&apos;s Standings {latestWeekly?.week ? `(Week ${latestWeekly.week})` : ""}
            </summary>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 mb-3">
              De-duplicated by display name — guest accounts can fragment the same person into multiple rows.
            </p>
            <div className="overflow-x-auto">
              <table className="min-w-max w-full text-sm">
                <thead className="bg-zinc-700 text-white">
                  <tr>
                    <th className="text-left px-3 py-2 w-[48px]">#</th>
                    <th className="text-left px-3 py-2">User Name</th>
                    <th className="text-right px-3 py-2 w-[72px]">Wins</th>
                    <th className="text-right px-3 py-2 w-[80px]">TB</th>
                  </tr>
                </thead>
                <tbody>
                  {lastWeekDeduped.map((s, idx) => (
                    <tr
                      key={s.uid}
                      className={idx % 2 ? "bg-zinc-50 dark:bg-zinc-900/60" : "bg-white dark:bg-zinc-800/60"}
                    >
                      <td className="px-3 py-2 font-medium">{s.rank}</td>
                      <td className="px-3 py-2 font-semibold">{s.displayName || s.uid}</td>
                      <td className="px-3 py-2 text-right">{s.wins ?? "—"}</td>
                      <td className="px-3 py-2 text-right">{s.tieBreaker ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
