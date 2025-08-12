import { useEffect, useMemo, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import { db } from "../lib/firebase";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
} from "firebase/firestore";

// You can wire these to router/query params later
const YEAR = 2025;
const SEASON = "pre";

export default function LeaderboardPage() {
  const [seasonDoc, setSeasonDoc] = useState(null);
  const [weeklyDocs, setWeeklyDocs] = useState([]);
  const [latestWeekly, setLatestWeekly] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);

      // Season aggregate (Points)
      const sSnap = await getDoc(doc(db, "season_leaderboard", `${YEAR}-${SEASON}`));
      const season = sSnap.exists() ? { id: sSnap.id, ...sSnap.data() } : null;

      // All weekly_results for Wins tally (no orderBy → no extra index)
      const wSnap = await getDocs(
        query(
          collection(db, "weekly_results"),
          where("year", "==", YEAR),
          where("season", "==", SEASON)
        )
      );
      const weeklies = [];
      wSnap.forEach((d) => weeklies.push({ id: d.id, ...d.data() }));

      // Latest winners (needs composite index: season asc, year asc, week desc)
      const latestSnap = await getDocs(
        query(
          collection(db, "weekly_results"),
          where("year", "==", YEAR),
          where("season", "==", SEASON),
          orderBy("week", "desc"),
          limit(1)
        )
      );
      let latest = null;
      latestSnap.forEach((d) => (latest = { id: d.id, ...d.data() }));

      setSeasonDoc(season);
      setWeeklyDocs(weeklies);
      setLatestWeekly(latest);
      setLoading(false);
    };
    load();
  }, []);

  // Map uid -> number of weekly titles (Wins)
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

  // Normalize latest winners to [{ uid, displayName, correctPicks, tieBreaker }]
  const latestWinners = useMemo(() => {
    if (!latestWeekly?.winners) return [];
    const standings = Array.isArray(latestWeekly.standings) ? latestWeekly.standings : [];
    const getStand = (uid) => standings.find((s) => s.uid === uid) || null;

    if (typeof latestWeekly.winners[0] === "string") {
      // legacy
      return latestWeekly.winners.map((uid) => {
        const s = getStand(uid);
        return {
          uid,
          displayName: seasonDoc?.players?.[uid]?.displayName || uid,
          correctPicks: s?.wins ?? null,
          tieBreaker: s?.tieBreaker ?? null,
        };
      });
    }
    // new shape
    return latestWeekly.winners.map((w) => {
      const s = getStand(w.uid);
      return {
        uid: w.uid,
        displayName: w.displayName || seasonDoc?.players?.[w.uid]?.displayName || w.uid,
        correctPicks: s?.wins ?? null,
        tieBreaker: s?.tieBreaker ?? null,
      };
    });
  }, [latestWeekly, seasonDoc]);

  // Build table rows (Mario Party rules)
  const rows = useMemo(() => {
    const players = seasonDoc?.players || {};
    const merged = Object.entries(players).map(([uid, p]) => ({
      uid,
      name: p.displayName || uid,
      wins: weeklyWinsMap.get(uid) || 0,  // weekly titles
      points: p.totalWins || 0,           // season correct picks
    }));

    merged.sort(
      (a, b) =>
        b.wins - a.wins ||
        b.points - a.points ||
        a.name.localeCompare(b.name)
    );

    // competition ranking: #1, #1, #3 …
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

  const prevWeek = Math.max((latestWeekly?.week || 1) - 1, 1);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-900 text-zinc-900 dark:text-white px-4 py-6">
      <Head>
        <title>Leaderboard • {YEAR} {SEASON.toUpperCase()}</title>
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
          ) : (
            <>
              <div className="space-y-2">
                {latestWinners.length ? (
                  latestWinners.map((w) => (
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
                  ))
                ) : (
                  <span className="text-zinc-500">—</span>
                )}
              </div>

              <div className="mt-4">
                <a
                  href={`http://localhost:3000/${YEAR}/${SEASON}/${prevWeek}/results`}
                  className="inline-flex items-center gap-2 text-indigo-600 hover:underline"
                >
                </a>
              </div>
            </>
          )}
        </section>

        {/* Season standings (Mario Party rules) */}
        <section className="bg-white dark:bg-zinc-800/70 rounded-xl border border-zinc-200 dark:border-zinc-700 p-5">
          <h2 className="text-xl font-bold mb-3">Season Standings</h2>

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

                    {/* Compact stats column on mobile */}
                    <th className="text-right px-3 py-2 sm:hidden w-[110px]">Wins • Pts</th>

                    {/* Separate columns on sm+ */}
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

                      {/* Mobile: combined stats */}
                      <td className="sm:hidden px-3 py-2 text-right">
                        {r.wins} • {r.points}
                      </td>

                      {/* sm+: separate columns */}
                      <td className="hidden sm:table-cell px-3 py-2 text-right">{r.wins}</td>
                      <td className="hidden sm:table-cell px-3 py-2 text-right">{r.points}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
