import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import { auth, db } from "../../../../lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { collectionGroup, getDocs, query, where } from "firebase/firestore";
import Image from "next/image";
import Head from "next/head";
import { ChevronDown, ChevronRight } from "lucide-react";

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

  const [lastUpdated, setLastUpdated] = useState(null);
  const [authReady, setAuthReady] = useState(false);

  // Portrait-only: which users' pick grids are expanded
  const [expandedUsers, setExpandedUsers] = useState(new Set());
  const toggleExpanded = useCallback((uid) => {
    setExpandedUsers((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  }, []);

  // Portrait-only: tapping a game box shows every user's pick for that game
  const [selectedGameID, setSelectedGameID] = useState(null);

  const pollTimer = useRef(null);
  const isFirstLoad = useRef(true);

  const keyNew = `${year}-${season}-W${week}`;

  const REFRESH_INTERVAL = 30_000;

  // Wait for the signed-in session to restore before querying Firestore,
  // otherwise a fresh page load can fire the query while logged out.
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, () => {
      setAuthReady(true);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!year || !week || !season || !authReady) return;

    let cancelled = false;
    isFirstLoad.current = true;

    const fetchData = async () => {
      // Only show the loading state on the very first load — background
      // auto-refreshes shouldn't flash the whole page back to "Loading...".
      if (isFirstLoad.current) setState((s) => ({ ...s, loading: true }));

      const seasontype = TYPE_MAP[season] ?? 2;
      const apiUrl = `/api/scoreboard?seasontype=${seasontype}&week=${week}&year=${year}`;

      const [weeksSnap, espnData] = await Promise.all([
        getDocs(query(collectionGroup(db, "weeks"), where("weekKey", "==", keyNew))),
        fetch(apiUrl).then((r) => r.json()),
      ]);

      if (cancelled) return;

      // Each week doc already stores the display name at submission time —
      // avoids a full "users" collection scan on every load/poll. Trade-off:
      // a name change after submitting won't retroactively update old weeks.
      const picks = [];
      for (const docSnap of weeksSnap.docs) {
        const userData = docSnap.data();
        const uid = docSnap.ref.parent.parent.id;

        const entries = Object.entries(userData)
          .filter(([k]) => !["tieBreaker", "displayName", "locked", "submittedAt", "lastEditedAt", "weekKey"].includes(k))
          .map(([eventID, team]) => ({ eventID, teamName: team }));

        picks.push({
          uid,
          displayName: userData.displayName || "Unknown",
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
          period: comp?.status?.period,
          displayClock: comp?.status?.displayClock,
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
      isFirstLoad.current = false;

      // Keep polling every 30s while any game hasn't finished; stop once the
      // whole week is final so we're not refreshing forever for no reason.
      const anyUnfinished = Object.values(tempMap).some((g) => g.status !== "post");
      if (anyUnfinished && !cancelled) {
        pollTimer.current = setTimeout(fetchData, REFRESH_INTERVAL);
      }
    };

    fetchData();

    return () => {
      cancelled = true;
      clearTimeout(pollTimer.current);
    };
  }, [year, week, season, authReady]);

  const uniqueEventIDs = useMemo(() => {
    return Object.keys(eventMap).sort(
      (a, b) => new Date(eventMap[a].date) - new Date(eventMap[b].date)
    );
  }, [eventMap]);

  const remainingEventIDs = useMemo(
    () => uniqueEventIDs.filter((id) => eventMap[id]?.status !== "post"),
    [uniqueEventIDs, eventMap]
  );

  // Enumerates every possible outcome of the remaining games to find which
  // ones let this user finish 1st (or tie for it), then summarizes the
  // outcomes that are required in every winning scenario. Capped at 14
  // remaining games (16k combinations) to keep this cheap.
  const buildScenario = useCallback(
    (targetUid) => {
      if (remainingEventIDs.length === 0 || remainingEventIDs.length > 14) return null;

      const picksByUid = new Map(
        submissions.map((s) => [s.uid, new Map(s.picks.map((p) => [p.eventID, p.teamName]))])
      );
      const decidedByUid = new Map(submissions.map((s) => [s.uid, s.winnerCount]));

      const totalCombos = 2 ** remainingEventIDs.length;
      const winningCombos = [];

      for (let mask = 0; mask < totalCombos; mask++) {
        const assignment = {};
        remainingEventIDs.forEach((id, i) => {
          const g = eventMap[id];
          const homeWins = (mask >> i) & 1;
          assignment[id] = homeWins ? g?.home?.short : g?.away?.short;
        });

        let maxWins = -Infinity;
        let targetWins = 0;
        for (const s of submissions) {
          const picks = picksByUid.get(s.uid);
          let wins = decidedByUid.get(s.uid) || 0;
          for (const id of remainingEventIDs) {
            if (picks.get(id) === assignment[id]) wins++;
          }
          if (wins > maxWins) maxWins = wins;
          if (s.uid === targetUid) targetWins = wins;
        }

        if (targetWins >= maxWins) winningCombos.push(assignment);
      }

      if (winningCombos.length === 0) return { status: "eliminated" };
      if (winningCombos.length === totalCombos) return { status: "locked" };

      // A game is "necessary" if every winning combo needed the same team to win it
      const necessary = [];
      for (const id of remainingEventIDs) {
        const values = new Set(winningCombos.map((c) => c[id]));
        if (values.size === 1) {
          const g = eventMap[id];
          const needShort = [...values][0];
          const needHome = needShort === g?.home?.short;
          necessary.push({
            needAbbr: needHome ? g?.home?.abbr : g?.away?.abbr,
            overAbbr: needHome ? g?.away?.abbr : g?.home?.abbr,
          });
        }
      }

      return {
        status: "conditional",
        necessary,
        fullyDetermined: necessary.length === remainingEventIDs.length,
      };
    },
    [remainingEventIDs, submissions, eventMap]
  );

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

  const formatGameDate = (iso) =>
    new Date(iso)
      .toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric", timeZone: "America/New_York" })
      .toUpperCase()
      .replace(",", "");
  const formatGameTimeET = (iso) =>
    new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });

  // ---------- FIX: reserve a status row height in every header cell ----------
  const HeaderCompact = ({ g, showScores }) => {
    const live = g?.status === "in";
    const clock = live && g?.displayClock ? `${g.period ? `Q${g.period} ` : ""}${g.displayClock}` : "";
    return (
      <div className="flex flex-col items-center leading-tight">
        {/* Status row: constant height; shows the live clock or an empty spacer */}
        <div className="mb-0.5 flex h-4 md:h-5 items-center justify-center">
          <span
            className={`text-[10px] md:text-[11px] font-semibold font-mono tracking-wide ${
              live && clock ? "text-rose-400" : "opacity-0"
            }`}
          >
            {clock || "-"}
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
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
           Week {week}
        </h1>

        <div className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {lastUpdated ? `Last Updated ${lastUpdated.toLocaleTimeString()}` : "—"}
          {" • "}
          {submissions.length} total participants
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-slate-100 dark:bg-zinc-800">
            <span className="w-2 h-2 rounded-full bg-emerald-500" /> Final: {totals.post}
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-slate-100 dark:bg-zinc-800">
            <span className="w-2 h-2 rounded-full bg-rose-500" /> Live: {totals.live}
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-slate-100 dark:bg-zinc-800">
            <span className="w-2 h-2 rounded-full bg-sky-400" /> Upcoming: {totals.pre}
          </span>
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

      {/* Table (landscape / wide screens) */}
      <div className="hidden sm:block max-w-8xl mx-auto overflow-x-auto pb-28">
        {/* min-w-max => table grows to fit columns; wrapper scrolls on small screens */}
        <table className={`min-w-max w-full text-base border-separate border-spacing-0 ${borderClass}`}>
          <thead className="bg-slate-800 text-white shadow-sm sticky top-0 z-20">
            <tr>
              <th
                className={`${W_USER} py-1 sticky left-0 z-30 bg-slate-800 font-bold text-left ${borderClass}`}
                style={{ paddingLeft: "max(0.5rem, env(safe-area-inset-left))", paddingRight: "0.5rem" }}
              >
                User
              </th>
              <th
                className={`${W_WINS} px-2 py-1 text-center font-bold sticky left-[168px] z-30 bg-slate-800 ${borderClass}`}
              >
                Wins
              </th>

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
              const rowBg = index % 2 === 0 ? "bg-white dark:bg-zinc-900" : "bg-gray-50 dark:bg-zinc-800";
              const picksMap = new Map(entry.picks.map((p) => [p.eventID, p.teamName]));

              return (
                <tr key={entry.uid} className={rowBg}>
                  <td
                    className={`${W_USER} py-1 sticky left-0 z-10 font-bold ${rowBg} ${borderClass} truncate whitespace-nowrap`}
                    style={{ paddingLeft: "max(0.5rem, env(safe-area-inset-left))", paddingRight: "0.5rem" }}
                    title={entry.displayName || ""}
                  >
                    {truncate14(entry.displayName)}
                  </td>

                  <td className={`${W_WINS} px-2 py-1 text-center sticky left-[168px] z-10 ${rowBg} ${borderClass}`}>
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

      {/* Expandable per-user view (portrait / narrow screens) */}
      <div className="sm:hidden max-w-8xl mx-auto pb-28">
        <table className={`w-full text-base border-separate border-spacing-0 ${borderClass}`}>
          <thead className="bg-slate-800 text-white shadow-sm">
            <tr>
              <th className={`py-1 text-left font-bold ${borderClass}`} style={{ paddingLeft: "max(0.5rem, env(safe-area-inset-left))" }}>
                User
              </th>
              <th className={`w-[56px] px-2 py-1 text-center font-bold ${borderClass}`}>Wins</th>
              <th className={`w-[72px] px-2 py-1 text-center font-bold ${borderClass}`}>TB</th>
            </tr>
          </thead>

          <tbody>
            {submissions.map((entry, index) => {
              const rowBg = index % 2 === 0 ? "bg-white dark:bg-zinc-900" : "bg-gray-50 dark:bg-zinc-800";
              const picksMap = new Map(entry.picks.map((p) => [p.eventID, p.teamName]));
              const isOpen = expandedUsers.has(entry.uid);

              return (
                <Fragment key={entry.uid}>
                  <tr
                    className={`${rowBg} cursor-pointer`}
                    onClick={() => toggleExpanded(entry.uid)}
                  >
                    <td
                      className={`py-1 font-bold ${rowBg} ${borderClass} truncate whitespace-nowrap`}
                      style={{ paddingLeft: "max(0.5rem, env(safe-area-inset-left))" }}
                      title={entry.displayName || ""}
                    >
                      <span className="inline-flex items-center gap-1">
                        {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        {truncate14(entry.displayName)}
                      </span>
                    </td>
                    <td className={`w-[56px] px-2 py-1 text-center ${rowBg} ${borderClass}`}>
                      {entry.winnerCount}
                    </td>
                    <td className={`w-[72px] px-2 py-1 text-center ${rowBg} ${borderClass}`}>
                      <span className="text-sm text-gray-700 dark:text-gray-300">
                        {entry.tieBreaker || "—"}
                      </span>
                    </td>
                  </tr>

                  {isOpen && (
                    <tr className={rowBg}>
                      <td colSpan={3} className={`${borderClass} p-2`}>
                        {(() => {
                          const scenario = buildScenario(entry.uid);
                          if (!scenario) return null;

                          let message;
                          if (scenario.status === "locked") {
                            message = "🔒 Locked in for 1st place this week!";
                          } else if (scenario.status === "eliminated") {
                            message = "Eliminated from 1st place this week.";
                          } else {
                            const parts = scenario.necessary.map((n) => `${n.needAbbr} beats ${n.overAbbr}`);
                            if (parts.length === 0) {
                              message =
                                "Path to 1st depends on how the remaining games go — several combinations could work in your favor.";
                            } else if (scenario.fullyDetermined) {
                              message = `Needs: ${parts.join(", ")} to finish 1st.`;
                            } else {
                              message = `Needs: ${parts.join(", ")} — plus the right combination of the other remaining game(s).`;
                            }
                          }

                          return (
                            <div className="mb-2 rounded-md bg-indigo-50 dark:bg-indigo-950 border border-indigo-200 dark:border-indigo-800 text-indigo-900 dark:text-indigo-100 px-2 py-1.5 text-xs">
                              {message}
                            </div>
                          );
                        })()}

                        <div className="grid grid-cols-2 gap-2">
                          {uniqueEventIDs.map((eventID) => {
                            const g = eventMap[eventID];
                            const pickTeam = picksMap.get(eventID);
                            const correct = winners[eventID] === pickTeam;
                            const pickedHome = g?.home?.abbr === pickTeam || g?.home?.short === pickTeam;
                            const team = pickedHome
                              ? { logo: g?.home?.logo, label: g?.home?.abbr }
                              : { logo: g?.away?.logo, label: g?.away?.abbr };
                            const opponent = pickedHome
                              ? { abbr: g?.away?.abbr, score: g?.awayScore }
                              : { abbr: g?.home?.abbr, score: g?.homeScore };
                            const pickScore = pickedHome ? g?.homeScore : g?.awayScore;
                            const isPending = g?.status !== "post";
                            const bgColor = isPending
                              ? "bg-slate-100 dark:bg-zinc-800 text-gray-900 dark:text-white"
                              : correct
                              ? "bg-green-200 dark:bg-green-300 text-gray-900"
                              : "bg-red-200 dark:bg-red-300 text-gray-900";
                            const showScore = g?.status === "in" || g?.status === "post";
                            const isLive = g?.status === "in";

                            return (
                              <div
                                key={eventID}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedGameID(eventID);
                                }}
                                className={`flex items-center gap-2 rounded-md px-2 py-1.5 min-h-11 cursor-pointer active:opacity-80 ${bgColor}`}
                              >
                                {pickTeam && team?.logo ? (
                                  <div className="flex flex-col items-center shrink-0">
                                    <Image src={team.logo} alt={team?.label || "Team"} width={28} height={28} />
                                    {isPending && (
                                      <span className="text-[8px] font-bold uppercase tracking-wide text-indigo-600 dark:text-indigo-400 leading-none mt-0.5">
                                        Pick
                                      </span>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-gray-400 w-7 text-center">–</span>
                                )}
                                <div className="flex flex-col leading-tight font-mono flex-1">
                                  <span className="text-sm font-bold">
                                    {team?.label || "—"}{showScore && pickScore != null ? ` ${pickScore}` : ""}
                                  </span>
                                  <span className="text-[10px] opacity-70">
                                    vs {opponent.abbr}{showScore && opponent.score != null ? ` ${opponent.score}` : ""}
                                  </span>
                                </div>
                                {isLive && (
                                  <div className="flex flex-col items-end leading-tight font-mono shrink-0">
                                    <span className="text-[10px] font-semibold text-rose-500">
                                      {g?.period ? `Q${g.period}` : ""}
                                    </span>
                                    <span className="text-[10px] opacity-70">{g?.displayClock || ""}</span>
                                  </div>
                                )}
                                {isPending && !isLive && g?.date && (
                                  <div className="flex flex-col items-end leading-tight font-mono shrink-0">
                                    <span className="text-[10px] font-semibold">{formatGameDate(g.date)}</span>
                                    <span className="text-[10px] opacity-70">{formatGameTimeET(g.date)}</span>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Portrait-only: all picks for one game, opened by tapping a game box */}
      {selectedGameID && (() => {
        const g = eventMap[selectedGameID];
        if (!g) return null;
        const isDecided = g.status === "post";
        const isLiveGame = g.status === "in";
        const showScore = isDecided || isLiveGame;
        // Tiebreaker is the combined score of the week's last-kickoff game
        const isTiebreakerGame = selectedGameID === uniqueEventIDs[uniqueEventIDs.length - 1];

        return (
          <div
            className="sm:hidden fixed inset-0 z-[60] flex items-end bg-black/50"
            onClick={() => setSelectedGameID(null)}
          >
            <div
              className="w-full max-h-[75vh] overflow-y-auto rounded-t-2xl bg-white dark:bg-zinc-900 text-gray-900 dark:text-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="font-bold text-lg">
                    {g.away?.abbr} {showScore && g.awayScore != null ? g.awayScore : ""} @ {g.home?.abbr}{" "}
                    {showScore && g.homeScore != null ? g.homeScore : ""}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {isLiveGame
                      ? `${g.period ? `Q${g.period} ` : ""}${g.displayClock || ""}`
                      : isDecided
                      ? "Final"
                      : g.date
                      ? `${formatGameDate(g.date)} ${formatGameTimeET(g.date)}`
                      : ""}
                  </div>
                  {isTiebreakerGame && (
                    <div className="mt-1 inline-block text-[10px] font-bold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">
                      Tiebreaker Game
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setSelectedGameID(null)}
                  className="px-3 py-1.5 rounded-md bg-slate-100 dark:bg-zinc-800 text-sm font-semibold"
                >
                  Close
                </button>
              </div>

              <div className="flex flex-col gap-2">
                {[...submissions].sort((a, b) => a.rank - b.rank).map((entry) => {
                  const pickTeam = entry.picks.find((p) => p.eventID === selectedGameID)?.teamName;
                  const pickedHome = g.home?.abbr === pickTeam || g.home?.short === pickTeam;
                  const label = pickTeam ? (pickedHome ? g.home?.abbr : g.away?.abbr) : "—";
                  const correct = winners[selectedGameID] === pickTeam;
                  const rowColor = !isDecided
                    ? "bg-slate-100 dark:bg-zinc-800"
                    : correct
                    ? "bg-green-200 dark:bg-green-300 text-gray-900"
                    : "bg-red-200 dark:bg-red-300 text-gray-900";

                  return (
                    <div
                      key={entry.uid}
                      className={`flex items-center justify-between rounded-md px-3 py-2 ${rowColor}`}
                    >
                      <span className="font-semibold">{truncate14(entry.displayName)}</span>
                      <span className="flex items-center gap-3">
                        {isTiebreakerGame && (
                          <span className="text-xs opacity-70">
                            TB: <span className="font-mono font-semibold">{entry.tieBreaker || "—"}</span>
                          </span>
                        )}
                        <span className="font-mono font-bold">{label}</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
