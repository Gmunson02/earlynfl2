import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { db } from "../../../../lib/firebase";
import { collection, getDocs } from "firebase/firestore";
import Image from "next/image";
import Head from "next/head";

const TYPE_MAP = { pre: 1, reg: 2, post: 3 };

export default function ScoresPage() {
  const router = useRouter();
  const { year, week, season } = router.query;

  const [state, setState] = useState({
    loading: true,
    submissions: [],
    eventMap: {},
    winners: {},
  });
  const { loading, submissions, eventMap, winners } = state;

  const [reloadTick, setReloadTick] = useState(0);
  const [lastUpdated, setLastUpdated] = useState(null);

  const keyNew = `${year}-${season}-W${week}`;
  const keyLegacy = `${year}-W${week}`;

  useEffect(() => {
    if (!year || !week || !season) return;

    const fetchData = async () => {
      setState((s) => ({ ...s, loading: true }));

      const seasontype = TYPE_MAP[season] ?? 2;
      const apiUrl = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=${seasontype}&week=${week}&year=${year}`;

      const [snap, espnData] = await Promise.all([
        getDocs(collection(db, "picks")),
        fetch(apiUrl).then((r) => r.json()),
      ]);

      // ---- Build picks list from Firestore
      const picks = [];
      for (const docSnap of snap.docs) {
        const data = docSnap.data();
        const userData = data[keyNew] || data[keyLegacy];
        if (!userData) continue;

        const entries = Object.entries(userData)
          .filter(([k]) => !["tieBreaker", "displayName", "locked", "submittedAt"].includes(k))
          .map(([eventID, team]) => ({ eventID, teamName: team }));

        picks.push({
          uid: docSnap.id,
          displayName: userData.displayName || "Unknown",
          picks: entries,
          tieBreaker: userData.tieBreaker || "",
        });
      }

      // ---- Normalize ESPN events (scores + status)
      const tempMap = {};
      const winnerMap = {};
      for (const event of espnData?.events || []) {
        const comp = event?.competitions?.[0];
        const comps = comp?.competitors || [];
        const homeComp = comps.find((c) => c.homeAway === "home");
        const awayComp = comps.find((c) => c.homeAway === "away");

        const home = homeComp?.team;
        const away = awayComp?.team;

        const homeScore = homeComp?.score != null ? Number(homeComp.score) : null;
        const awayScore = awayComp?.score != null ? Number(awayComp.score) : null;

        tempMap[event.id] = {
          date: event.date,
          status: comp?.status?.type?.state, // "pre" | "in" | "post"
          home: {
            abbr: home?.abbreviation || home?.shortDisplayName || "—",
            logo: home?.logo,
            short: home?.shortDisplayName,
          },
          away: {
            abbr: away?.abbreviation || away?.shortDisplayName || "—",
            logo: away?.logo,
            short: away?.shortDisplayName,
          },
          homeScore,
          awayScore,
        };

        if (comp?.status?.type?.state === "post") {
          const w = comps.find((c) => c.winner);
          if (w) winnerMap[event.id] = w.team.shortDisplayName;
        }
      }

      // ---- Score + rank
      const enriched = picks.map((entry) => {
        const picksMap = new Map(entry.picks.map((p) => [p.eventID, p.teamName]));
        const winnerCount = Object.keys(tempMap).reduce(
          (acc, id) => acc + (winnerMap[id] && winnerMap[id] === picksMap.get(id) ? 1 : 0),
          0
        );
        return { ...entry, winnerCount };
      });

      enriched.sort((a, b) => b.winnerCount - a.winnerCount);
      let lastWins = null, rank = 0, skip = 1;
      const ranked = enriched.map((entry) => {
        if (entry.winnerCount !== lastWins) { rank += skip; skip = 1; } else { skip++; }
        lastWins = entry.winnerCount;
        return { ...entry, rank };
      });

      setState({
        loading: false,
        submissions: ranked,
        eventMap: tempMap,
        winners: winnerMap,
      });
      setLastUpdated(new Date());
    };

    fetchData();
  }, [year, week, season, reloadTick]);

  // sorted event IDs
  const uniqueEventIDs = useMemo(() => {
    return Object.keys(eventMap).sort(
      (a, b) => new Date(eventMap[a].date) - new Date(eventMap[b].date)
    );
  }, [eventMap]);

  // header stats
  const totals = useMemo(() => {
    const total = uniqueEventIDs.length;
    let post = 0, live = 0, pre = 0;
    for (const id of uniqueEventIDs) {
      const s = eventMap[id]?.status;
      if (s === "post") post++;
      else if (s === "in") live++;
      else pre++;
    }
    return { total, post, live, pre };
  }, [uniqueEventIDs, eventMap]);

  if (loading && !lastUpdated) return <div className="p-6 text-center">Loading...</div>;

  const borderClass = "border border-gray-300";

  // helpers for headers
  const pad2 = (n) => {
    if (n == null || Number.isNaN(n)) return "-";
    const s = String(n);
    return s.length === 1 ? ` ${s}` : s.slice(-2);
  };
  const padAbbr = (abbr) => {
    if (!abbr) return "—";
    return abbr.length === 2 ? `${abbr} ` : abbr.slice(0, 3);
  };
  const truncate14 = (str) => {
    if (!str) return "";
    return str.length > 14 ? `${str.slice(0, 13)}…` : str;
  };

  // 8ch fixed: abbr left, score right; score '-' until live/final
  const HeaderLine = ({ abbr, score, showScore }) => (
    <div className="w-[8ch] font-mono leading-tight">
      <div className="flex justify-between">
        <span className="min-w-[3ch] text-left">{padAbbr(abbr)}</span>
        <span className="w-[2ch] text-right">{showScore ? pad2(score) : "-"}</span>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 text-gray-900 dark:text-white px-2 py-4 sm:px-4 sm:py-8">
      <Head>
        <title>{(season || "reg").toUpperCase()} • Week {week} Scores</title>
      </Head>

      {/* ---------- Header ---------- */}
      <section className="max-w-6xl mx-auto mb-4">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              NFL {year} • {season?.toUpperCase()} • Week {week}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-slate-100 dark:bg-zinc-800">
                <span className="w-2 h-2 rounded-full bg-emerald-500" /> Final: {totals.post}
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-slate-100 dark:bg-zinc-800">
                <span className="w-2 h-2 rounded-full bg-rose-500" /> Live: {totals.live}
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-slate-100 dark:bg-zinc-800">
                <span className="w-2 h-2 rounded-full bg-sky-400" /> Upcoming: {totals.pre}
              </span>
              <span className="text-gray-400">•</span>
              <span className="text-gray-600 dark:text-gray-400">
                {submissions.length} players
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setReloadTick((x) => x + 1)}
              className="px-3 py-1.5 text-sm font-semibold rounded-md bg-indigo-600 text-white hover:bg-indigo-700"
            >
              Refresh
            </button>
            <div className="text-[11px] text-gray-500 dark:text-gray-400">
              {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : "—"}
            </div>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-3">
          <div className="h-2 w-full rounded-full bg-gray-200 dark:bg-zinc-800 overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-all"
              style={{ width: totals.total ? `${(totals.post / totals.total) * 100}%` : "0%" }}
            />
          </div>
          <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
            {totals.post}/{totals.total} games final
          </div>
        </div>

        {/* Legend */}
        <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-gray-600 dark:text-gray-400">
          <span className="inline-flex items-center gap-1">
            <span className="w-3 h-3 rounded bg-green-200 border border-green-300 dark:border-green-600" /> Correct
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-3 h-3 rounded bg-red-200 border border-red-300 dark:border-red-600" /> Wrong
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-3 h-3 rounded bg-transparent border border-gray-300 dark:border-gray-700" /> Pending
          </span>
        </div>
      </section>

      {/* ---------- Table ---------- */}
      <div className="max-w-full overflow-x-auto pb-28">
        <table className={`min-w-full text-sm border-collapse ${borderClass} table-auto`}>
          <thead className="bg-slate-800 text-white shadow-sm">
            <tr>
              {/* User: sticky and wider, trunc to 14 chars */}
              <th
                className={`px-2 py-0.5 sticky left-0 z-10 bg-slate-800 font-bold text-left ${borderClass}`}
                style={{ minWidth: "16ch" }}
              >
                User
              </th>

              {/* Wins: 4ch wide */}
              <th
                className={`px-2 py-0.5 text-center font-bold ${borderClass}`}
                style={{ width: "4ch", minWidth: "4ch" }}
              >
                Wins
              </th>

              {uniqueEventIDs.map((id) => {
                const g = eventMap[id];
                const showScore = g?.status === "in" || g?.status === "post";
                const isLive = g?.status === "in";
                return (
                  <th
                    key={id}
                    className={`px-1 py-0.5 text-center font-bold ${borderClass}`}
                    style={{ width: "8ch", minWidth: "8ch" }}
                  >
                    {isLive && (
                      <div className="mb-0.5 text-[10px] font-semibold tracking-wide text-rose-400">
                        – LIVE –
                      </div>
                    )}
                    <HeaderLine abbr={g?.home?.abbr} score={g?.homeScore} showScore={showScore} />
                    <HeaderLine abbr={g?.away?.abbr} score={g?.awayScore} showScore={showScore} />
                  </th>
                );
              })}

              <th className={`px-2 py-0.5 text-center font-bold bg-slate-800 ${borderClass}`}>TB</th>
            </tr>
          </thead>
          <tbody>
            {submissions.map((entry, index) => {
              const rowBg =
                index % 2 === 0 ? "bg-white dark:bg-zinc-900" : "bg-gray-50 dark:bg-zinc-800";
              const picksMap = new Map(entry.picks.map((p) => [p.eventID, p.teamName]));

              return (
                <tr key={entry.uid} className={rowBg}>
                  <td
                    className={`px-2 py-0.5 sticky left-0 z-10 font-bold ${rowBg} ${borderClass} truncate`}
                    style={{ maxWidth: "20ch" }}
                    title={entry.displayName || ""}
                  >
                    {truncate14(entry.displayName)}
                  </td>

                  <td
                    className={`px-2 py-0.5 text-center ${borderClass}`}
                    style={{ width: "4ch", minWidth: "4ch" }}
                  >
                    {entry.winnerCount}
                  </td>

                  {uniqueEventIDs.map((eventID) => {
                    const pickTeam = picksMap.get(eventID);
                    const correct = winners[eventID] === pickTeam;
                    const g = eventMap[eventID];
                    const pickedHome =
                      g?.home?.abbr === pickTeam || g?.home?.short === pickTeam;
                    const team = pickedHome
                      ? { logo: g?.home?.logo, label: g?.home?.abbr }
                      : { logo: g?.away?.logo, label: g?.away?.abbr };
                    const isPending = g?.status !== "post";
                    const bgColor = isPending ? "" : correct ? "bg-green-200" : "bg-red-200";

                    return (
                      <td
                        key={eventID}
                        className={`text-center px-1 py-0.5 ${borderClass} ${bgColor}`}
                        style={{ width: "8ch", minWidth: "8ch" }}
                      >
                        {pickTeam && team?.logo ? (
                          <Image
                            src={team.logo}
                            alt={team?.label || "Team"}
                            width={40}
                            height={40}
                            className="mx-auto"
                          />
                        ) : (
                          <span className="text-gray-400">–</span>
                        )}
                      </td>
                    );
                  })}

                  <td className={`px-2 py-0.5 text-center bg-white dark:bg-gray-950 ${borderClass}`}>
                    <span className="text-xs text-gray-600 dark:text-gray-300">
                      {entry.tieBreaker || "—"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
