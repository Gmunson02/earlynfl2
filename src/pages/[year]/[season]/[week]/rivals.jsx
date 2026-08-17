import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import { auth, db } from "../../../../lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { collection, collectionGroup, getDocs, orderBy, query, where } from "firebase/firestore";
import Image from "next/image";
import Head from "next/head";
import { ArrowLeftRight } from "lucide-react";
import { fetchDisplayNameMap } from "../../../../lib/liveDisplayNames";

const TYPE_MAP = { pre: 1, reg: 2, post: 3 };
const REFRESH_INTERVAL = 30_000;

// A decided game with equal scores is a tie — no winner gets recorded for
// it, so nobody's pick counts as correct or incorrect for that game.
const isGameTied = (g) =>
  g?.status === "post" && g?.homeScore != null && g?.awayScore != null && g.homeScore === g.awayScore;

export default function ComparePage() {
  const router = useRouter();
  const { year, week, season } = router.query;

  const [state, setState] = useState({ loading: true, submissions: [], eventMap: {}, winners: {} });
  const { loading, submissions, eventMap, winners } = state;

  const [authReady, setAuthReady] = useState(false);
  const [myUid, setMyUid] = useState(null);
  const [uidA, setUidA] = useState(null);
  const [uidB, setUidB] = useState(null);
  const [showAllGames, setShowAllGames] = useState(false);
  const [weeksList, setWeeksList] = useState([]);

  const pollTimer = useRef(null);
  const isFirstLoad = useRef(true);
  const keyNew = `${year}-${season}-W${week}`;

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setAuthReady(true);
      setMyUid(u?.uid || null);
    });
    return unsub;
  }, []);

  // Full list of weeks for the picker (public read, no auth wait needed)
  useEffect(() => {
    (async () => {
      const snap = await getDocs(query(collection(db, "schedules", "nfl-2026", "weeks"), orderBy("order", "asc")));
      setWeeksList(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    })();
  }, []);

  // Reset player selections when the week changes so we don't carry over
  // uids from a week's participant list into a different week's list
  useEffect(() => {
    setUidA(null);
    setUidB(null);
  }, [keyNew]);

  useEffect(() => {
    if (!year || !week || !season || !authReady) return;

    let cancelled = false;
    isFirstLoad.current = true;

    const fetchData = async () => {
      if (isFirstLoad.current) setState((s) => ({ ...s, loading: true }));

      const seasontype = TYPE_MAP[season] ?? 2;
      const apiUrl = `/api/scoreboard?seasontype=${seasontype}&week=${week}&year=${year}`;

      const [weeksSnap, espnData, nameMap] = await Promise.all([
        getDocs(query(collectionGroup(db, "weeks"), where("weekKey", "==", keyNew))),
        fetch(apiUrl).then((r) => r.json()),
        fetchDisplayNameMap(),
      ]);

      if (cancelled) return;

      const picks = [];
      for (const docSnap of weeksSnap.docs) {
        const userData = docSnap.data();
        const uid = docSnap.ref.parent.parent.id;
        const entries = Object.entries(userData)
          .filter(([k]) => !["tieBreaker", "displayName", "locked", "submittedAt", "lastEditedAt", "weekKey"].includes(k))
          .map(([eventID, team]) => ({ eventID, teamName: team }));
        picks.push({ uid, displayName: nameMap.get(uid) || userData.displayName || "Unknown", picks: entries, tieBreaker: userData.tieBreaker || "" });
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
          home: { abbr: home?.abbreviation || home?.shortDisplayName || "—", logo: home?.logo, short: home?.shortDisplayName },
          away: { abbr: away?.abbreviation || away?.shortDisplayName || "—", logo: away?.logo, short: away?.shortDisplayName },
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

      setState({ loading: false, submissions: ranked, eventMap: tempMap, winners: winnerMap });
      isFirstLoad.current = false;

      const anyUnfinished = Object.values(tempMap).some((g) => g.status !== "post");
      if (anyUnfinished && !cancelled) pollTimer.current = setTimeout(fetchData, REFRESH_INTERVAL);
    };

    fetchData();
    return () => {
      cancelled = true;
      clearTimeout(pollTimer.current);
    };
  }, [year, week, season, authReady, keyNew]);

  const uniqueEventIDs = useMemo(
    () => Object.keys(eventMap).sort((a, b) => new Date(eventMap[a].date) - new Date(eventMap[b].date)),
    [eventMap]
  );

  // Default A to "me" if I'm in the league, else the current #1; default B
  // to the current #1 that isn't A (or the next-best participant)
  useEffect(() => {
    if (submissions.length === 0 || uidA) return;
    const me = myUid && submissions.find((s) => s.uid === myUid);
    const top = submissions.find((s) => s.rank === 1);
    const a = me || top || submissions[0];
    const b = submissions.find((s) => s.uid !== a.uid && s.rank === 1) || submissions.find((s) => s.uid !== a.uid);
    setUidA(a.uid);
    setUidB(b?.uid || a.uid);
  }, [submissions, myUid, uidA]);

  const truncate14 = (str) => (!str ? "" : str.length > 14 ? `${str.slice(0, 13)}…` : str);

  const userA = submissions.find((s) => s.uid === uidA);
  const userB = submissions.find((s) => s.uid === uidB);

  // Always sorted earliest -> latest kickoff (uniqueEventIDs is already sorted that way)
  const tiebreakerEventID = uniqueEventIDs[uniqueEventIDs.length - 1];
  const tiebreakerGame = eventMap[tiebreakerEventID];
  const tiebreakerFinal =
    tiebreakerGame?.status === "post" && tiebreakerGame.homeScore != null && tiebreakerGame.awayScore != null
      ? tiebreakerGame.homeScore + tiebreakerGame.awayScore
      : null;
  const tiebreakerFinalLabel =
    tiebreakerFinal != null ? `${tiebreakerGame.awayScore}-${tiebreakerGame.homeScore} (${tiebreakerFinal})` : null;

  const weekComplete = uniqueEventIDs.length > 0 && uniqueEventIDs.every((id) => eventMap[id]?.status === "post");

  const displayedGameIDs = useMemo(
    () =>
      showAllGames || weekComplete
        ? uniqueEventIDs
        : uniqueEventIDs.filter((id) => eventMap[id]?.status !== "post"),
    [uniqueEventIDs, eventMap, showAllGames, weekComplete]
  );

  const comparison = useMemo(() => {
    if (!userA || !userB) return null;
    const picksA = new Map(userA.picks.map((p) => [p.eventID, p.teamName]));
    const picksB = new Map(userB.picks.map((p) => [p.eventID, p.teamName]));
    const diverging = displayedGameIDs.filter((id) => picksA.get(id) !== picksB.get(id));
    let aRight = 0;
    let bRight = 0;
    let decidedCount = 0;
    let tiedCount = 0;
    for (const id of diverging) {
      const g = eventMap[id];
      const isDecided = g?.status === "post";
      if (isDecided) decidedCount++;
      if (isGameTied(g)) {
        tiedCount++;
        continue; // tie — nobody's pick counts as correct for this game
      }
      if (winners[id] === picksA.get(id)) aRight++;
      if (winners[id] === picksB.get(id)) bRight++;
    }
    return { picksA, picksB, diverging, aRight, bRight, decidedCount, tiedCount };
  }, [userA, userB, displayedGameIDs, winners, eventMap]);

  const sortedByRank = useMemo(() => [...submissions].sort((a, b) => a.rank - b.rank), [submissions]);

  if (loading) return <div className="p-6 text-center">Loading...</div>;

  const labelFor = (g, pickTeam, pickedHome) => (pickTeam ? (pickedHome ? g?.home?.abbr : g?.away?.abbr) : "—");
  const logoFor = (g, pickTeam, pickedHome) => (pickTeam ? (pickedHome ? g?.home?.logo : g?.away?.logo) : null);

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 text-gray-900 dark:text-white px-2 py-4 sm:px-4 sm:py-8 text-[15px] sm:text-base">
      <Head>
        <title>Compare • Week {week}</title>
      </Head>

      <section className="max-w-4xl mx-auto mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-3xl sm:text-4xl font-extrabold tracking-tight">
            <ArrowLeftRight size={30} /> Compare
          </h1>
          <div className="mt-1 text-sm text-gray-600 dark:text-gray-400">Week {week} head-to-head</div>
        </div>

        {weeksList.length > 0 && (
          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400">Week</label>
            <select
              value={weeksList.find((w) => String(w.seasonYear) === String(year) && w.seasonType === season && String(w.value) === String(week))?.id || ""}
              onChange={(e) => {
                const w = weeksList.find((x) => x.id === e.target.value);
                if (w) router.push(`/${w.seasonYear}/${w.seasonType}/${w.value}/rivals`);
              }}
              className="mt-1 block rounded-md border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm"
            >
              {weeksList.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.label || w.id}
                </option>
              ))}
            </select>
          </div>
        )}
      </section>

      <section className="max-w-4xl mx-auto mb-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400">Player A</label>
          <select
            value={uidA || ""}
            onChange={(e) => setUidA(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm"
          >
            {sortedByRank
              .filter((s) => s.uid !== uidB)
              .map((s) => (
                <option key={s.uid} value={s.uid}>
                  #{s.rank} {s.displayName} ({s.winnerCount} wins)
                </option>
              ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400">Player B</label>
          <select
            value={uidB || ""}
            onChange={(e) => setUidB(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm"
          >
            {sortedByRank
              .filter((s) => s.uid !== uidA)
              .map((s) => (
                <option key={s.uid} value={s.uid}>
                  #{s.rank} {s.displayName} ({s.winnerCount} wins)
                </option>
              ))}
          </select>
        </div>
      </section>

      {userA && userB && comparison && (
        <>
          <section className="max-w-4xl mx-auto mb-6 rounded-xl bg-indigo-50 dark:bg-indigo-950 border border-indigo-200 dark:border-indigo-800 px-4 py-3">
            <div className="flex items-center justify-between text-sm sm:text-base">
              <div>
                <div className="font-bold">{truncate14(userA.displayName)}</div>
                <div className="text-gray-500 dark:text-gray-400 text-xs sm:text-sm">
                  Rank #{userA.rank}, {userA.winnerCount} wins
                </div>
              </div>
              <ArrowLeftRight size={18} className="opacity-60 shrink-0 mx-2" />
              <div className="text-right">
                <div className="font-bold">{truncate14(userB.displayName)}</div>
                <div className="text-gray-500 dark:text-gray-400 text-xs sm:text-sm">
                  Rank #{userB.rank}, {userB.winnerCount} wins
                </div>
              </div>
            </div>
            <div className="mt-2 text-center text-sm">
              {comparison.diverging.length === 0 ? (
                weekComplete ? "Week complete — same picks on every game." : "Same picks on every game shown — nothing to compare."
              ) : (
                <>
                  {weekComplete && "Week complete. "}
                  {comparison.diverging.length} game{comparison.diverging.length === 1 ? "" : "s"} where picks differ
                  {comparison.decidedCount > 0 && (
                    <>
                      {" "}— {truncate14(userA.displayName)} correct on {comparison.aRight}, {truncate14(userB.displayName)} correct on {comparison.bRight}
                      {comparison.tiedCount > 0 && `, ${comparison.tiedCount} tied`}
                      {comparison.decidedCount < comparison.diverging.length &&
                        ` (${comparison.diverging.length - comparison.decidedCount} still pending)`}
                    </>
                  )}
                </>
              )}
            </div>

            {tiebreakerFinal != null && (
              <div className="mt-3 pt-3 border-t border-indigo-200 dark:border-indigo-800 text-center text-sm">
                <div className="font-bold uppercase tracking-wide text-xs text-indigo-600 dark:text-indigo-400 mb-1">
                  Tiebreaker — Final: {tiebreakerFinalLabel}
                </div>
                <div className="flex items-center justify-center gap-6">
                  <span>
                    {truncate14(userA.displayName)}: {userA.tieBreaker || "—"}
                    {userA.tieBreaker !== "" && userA.tieBreaker != null && (
                      <span className="text-gray-500 dark:text-gray-400">
                        {" "}(off by {Math.abs(Number(userA.tieBreaker) - tiebreakerFinal)})
                      </span>
                    )}
                  </span>
                  <span>
                    {truncate14(userB.displayName)}: {userB.tieBreaker || "—"}
                    {userB.tieBreaker !== "" && userB.tieBreaker != null && (
                      <span className="text-gray-500 dark:text-gray-400">
                        {" "}(off by {Math.abs(Number(userB.tieBreaker) - tiebreakerFinal)})
                      </span>
                    )}
                  </span>
                </div>
              </div>
            )}
          </section>

          {!weekComplete && (
            <section className="max-w-4xl mx-auto mb-3 flex items-center justify-between">
              <div className="text-sm text-gray-600 dark:text-gray-400">
                {showAllGames ? "Showing all games" : "Showing live & upcoming games"}
              </div>
              <button
                onClick={() => setShowAllGames((v) => !v)}
                className="px-3 py-1.5 rounded-md bg-slate-100 dark:bg-zinc-800 text-sm font-semibold"
              >
                {showAllGames ? "Show remaining only" : "Show all games"}
              </button>
            </section>
          )}

          <section className="max-w-4xl mx-auto sticky top-0 z-10 grid grid-cols-2 mb-2 rounded-lg overflow-hidden divide-x divide-indigo-400 dark:divide-indigo-700 bg-indigo-600 dark:bg-indigo-800 text-white shadow-md">
            <div className="px-3 py-2.5 text-base sm:text-lg font-extrabold truncate">{userA.displayName}</div>
            <div className="px-3 py-2.5 text-base sm:text-lg font-extrabold text-right truncate">{userB.displayName}</div>
          </section>

          <section className="max-w-4xl mx-auto flex flex-col gap-3 pb-16">
            {displayedGameIDs.length === 0 && (
              <div className="text-center text-sm text-gray-500 dark:text-gray-400 py-8">
                No live or upcoming games left this week.
              </div>
            )}
            {displayedGameIDs.map((id) => {
              const g = eventMap[id];
              const pickA = comparison.picksA.get(id);
              const pickB = comparison.picksB.get(id);
              const pickedHomeA = g?.home?.abbr === pickA || g?.home?.short === pickA;
              const pickedHomeB = g?.home?.abbr === pickB || g?.home?.short === pickB;
              const isDecided = g?.status === "post";
              const correctA = winners[id] === pickA;
              const correctB = winners[id] === pickB;
              const isTiebreakerGame = id === tiebreakerEventID;
              const tied = isGameTied(g);
              const colorFor = (correct) =>
                !isDecided
                  ? "bg-slate-100 dark:bg-zinc-800"
                  : tied
                  ? "bg-blue-200 dark:bg-blue-300 text-gray-900"
                  : correct
                  ? "bg-green-200 dark:bg-green-300 text-gray-900"
                  : "bg-red-200 dark:bg-red-300 text-gray-900";

              return (
                <div
                  key={id}
                  className={`rounded-xl overflow-hidden border ${
                    isTiebreakerGame
                      ? "border-indigo-400 dark:border-indigo-600 ring-1 ring-indigo-300 dark:ring-indigo-700"
                      : "border-gray-200 dark:border-zinc-700"
                  }`}
                >
                  <div className="flex items-center justify-between px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400 bg-slate-50 dark:bg-zinc-800/50">
                    <span>
                      {g?.away?.abbr} @ {g?.home?.abbr}
                      {isTiebreakerGame && tiebreakerFinal != null && (
                        <span className="ml-2 font-bold text-indigo-600 dark:text-indigo-400">
                          Final: {tiebreakerFinalLabel}
                        </span>
                      )}
                    </span>
                    {tied && (
                      <span className="font-bold uppercase tracking-wide text-blue-600 dark:text-blue-400">
                        Tied
                      </span>
                    )}
                    {isTiebreakerGame && (
                      <span className="font-bold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">
                        Tiebreaker Game
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 divide-x divide-gray-300 dark:divide-zinc-600">
                    <div className={`flex items-center gap-2 px-3 py-2.5 ${colorFor(correctA)}`}>
                      {logoFor(g, pickA, pickedHomeA) && (
                        <Image src={logoFor(g, pickA, pickedHomeA)} alt="" width={28} height={28} />
                      )}
                      <span className="flex items-baseline gap-2">
                        <span className="font-mono font-bold">{labelFor(g, pickA, pickedHomeA)}</span>
                        {isTiebreakerGame && (
                          <span className="font-mono font-bold text-base">TB {userA.tieBreaker || "—"}</span>
                        )}
                      </span>
                    </div>
                    <div className={`flex items-center justify-end gap-2 px-3 py-2.5 ${colorFor(correctB)}`}>
                      <span className="flex items-baseline gap-2">
                        {isTiebreakerGame && (
                          <span className="font-mono font-bold text-base">TB {userB.tieBreaker || "—"}</span>
                        )}
                        <span className="font-mono font-bold">{labelFor(g, pickB, pickedHomeB)}</span>
                      </span>
                      {logoFor(g, pickB, pickedHomeB) && (
                        <Image src={logoFor(g, pickB, pickedHomeB)} alt="" width={28} height={28} />
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </section>
        </>
      )}
    </div>
  );
}
