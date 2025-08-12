import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { db } from "../../../../lib/firebase";
import { collection, getDocs } from "firebase/firestore";
import Image from "next/image";
import Head from "next/head";

const TYPE_MAP = { pre: 1, reg: 2, post: 3 };

// Reusable widths so table scrolls instead of crushing cells
const W_USER = "w-[168px] min-w-[168px]";     // ~14ch
const W_WINS = "w-[56px]  min-w-[56px]";
const W_GAME = "w-[64px]  min-w-[64px] md:w-[80px] md:min-w-[80px]";
const W_TB   = "w-[72px]  min-w-[72px]";

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

      const [picksSnap, usersSnap, espnData] = await Promise.all([
        getDocs(collection(db, "picks")),
        getDocs(collection(db, "users")),
        fetch(apiUrl).then((r) => r.json()),
      ]);

      const usersMap = {};
      usersSnap.forEach((d) => {
        const u = d.data();
        usersMap[d.id] = u?.displayName || "";
      });

      const picks = [];
      for (const docSnap of picksSnap.docs) {
        const data = docSnap.data();
        const userData = data[keyNew] || data[keyLegacy];
        if (!userData) continue;

        const entries = Object.entries(userData)
          .filter(([k]) => !["tieBreaker", "displayName", "locked", "submittedAt"].includes(k))
          .map(([eventID, team]) => ({ eventID, teamName: team }));

        picks.push({
          uid: docSnap.id,
          displayName: usersMap[docSnap.id] || userData.displayName || "Unknown",
          picks: entries,
          tieBreaker: userData.tieBreaker || "",
        });
      }

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
          status: comp?.status?.type?.state,
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

  const uniqueEventIDs = useMemo(() => {
    return Object.keys(eventMap).sort(
      (a, b) => new Date(eventMap[a].date) - new Date(eventMap[b].date)
    );
  }, [eventMap]);

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
  const truncate14 = (str) => (!str ? "" : str.length > 14 ? `${str.slice(0, 13)}…` : str);

  // ---------- FIX: reserve a status row height in every header cell ----------
  const HeaderCompact = ({ g, showScores }) => {
    const live = g?.status === "in";
    return (
      <div className="flex flex-col items-center leading-tight">
        {/* Status row: constant height; shows LIVE or an empty spacer */}
        <div className="mb-0.5 flex h-4 md:h-5 items-center justify-center">
          <span
            className={`text-[10px] md:text-[11px] font-semibold tracking-wide ${
              live ? "text-rose-400" : "opacity-0"
            }`}
          >
            LIVE
          </span>
        </div>

        {/* Two compact rows: home and away with optional scores */}
        <div className="flex justify-between w-full text-xs md:text-[13px] font-mono whitespace-nowrap">
          <span>{g?.away?.abbr}</span>
          <span>{showScores ? g?.awayScore ?? "-" : "-"}</span>
        </div>
        <div className="flex justify-between w-full text-xs md:text-[13px] font-mono whitespace-nowrap">
          <span>{g?.home?.abbr}</span>
          <span>{showScores ? g?.homeScore ?? "-" : "-"}</span>
        </div>

      </div>
    );
  };
  // --------------------------------------------------------------------------

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 text-gray-900 dark:text-white px-2 py-4 sm:px-4 sm:py-8 text-[15px] sm:text-base">
      <Head>
        <title>{(season || "reg").toUpperCase()} • Week {week} Scores</title>
      </Head>

      {/* Header (same width feel as table via centered container) */}
      <section className="max-w-8xl mx-auto mb-4 px-1 sm:px-0">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
               Week {week}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
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
              className="px-3 py-2 text-sm font-semibold rounded-md bg-indigo-600 text-white hover:bg-indigo-700"
            >
              Refresh
            </button>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : "—"}
            </div>
          </div>
        </div>

        <div className="mt-3">
          <div className="h-2 w-full rounded-full bg-gray-200 dark:bg-zinc-800 overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-all"
              style={{ width: totals.total ? `${(totals.post / totals.total) * 100}%` : "0%" }}
            />
          </div>
          <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {totals.post}/{totals.total} games final
          </div>
        </div>
      </section>

      {/* Table */}
      <div className="max-w-8xl mx-auto overflow-x-auto pb-28">
        {/* min-w-max => table grows to fit columns; wrapper scrolls on small screens */}
        <table className={`min-w-max w-full text-base border-collapse ${borderClass}`}>
          <thead className="bg-slate-800 text-white shadow-sm">
            <tr>
              <th className={`${W_USER} px-2 py-1 sticky left-0 z-10 bg-slate-800 font-bold text-left ${borderClass}`}>
                User
              </th>
              <th className={`${W_WINS} px-2 py-1 text-center font-bold ${borderClass}`}>Wins</th>

              {uniqueEventIDs.map((id) => {
                const g = eventMap[id];
                const showScore = g?.status === "in" || g?.status === "post";
                return (
                  <th key={id} className={`${W_GAME} px-1 py-1 text-center font-bold ${borderClass}`}>
                    <HeaderCompact g={g} showScores={showScore} />
                  </th>
                );
              })}

              <th className={`${W_TB} px-2 py-1 text-center font-bold bg-slate-800 ${borderClass}`}>TB</th>
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
                    className={`${W_USER} px-2 py-1 sticky left-0 z-10 font-bold ${rowBg} ${borderClass} truncate whitespace-nowrap`}
                    title={entry.displayName || ""}
                  >
                    {truncate14(entry.displayName)}
                  </td>

                  <td className={`${W_WINS} px-2 py-1 text-center ${borderClass}`}>
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
                        className={`${W_GAME} text-center px-1 py-1 ${borderClass} ${bgColor}`}
                      >
                        {pickTeam && team?.logo ? (
                          <Image
                            src={team.logo}
                            alt={team?.label || "Team"}
                            width={50}
                            height={50}
                            className="mx-auto"
                          />
                        ) : (
                          <span className="text-gray-400">–</span>
                        )}
                      </td>
                    );
                  })}

                  <td className={`${W_TB} px-2 py-1 text-center bg-white dark:bg-gray-950 ${borderClass}`}>
                    <span className="text-sm text-gray-700 dark:text-gray-300">
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
