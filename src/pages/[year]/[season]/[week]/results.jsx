import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { auth, db } from "../../../../lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { collectionGroup, getDocs, query, where } from "firebase/firestore";
import Image from "next/image";
import Head from "next/head";
import { ChevronDown, ChevronRight } from "lucide-react";
import { fetchDisplayNameMap } from "../../../../lib/liveDisplayNames";
import { getScoreboard } from "../../../../lib/espnScoreboard";
import { getWeekLabel } from "../../../../lib/weekLabels";
import useWeekLabel from "../../../../hooks/useWeekLabel";

const TYPE_MAP = { pre: 1, reg: 2, post: 3 };
const MAX_SCENARIO_GAMES = 4;

// Everything in a week's pick doc that isn't an eventId -> team selection.
// adminUnlockUntil was missing here, so an admin-unlocked user's doc grew a
// bogus "pick" entry keyed on that field.
const PICK_DOC_SYSTEM_FIELDS = [
  "tieBreaker",
  "displayName",
  "locked",
  "submittedAt",
  "lastEditedAt",
  "weekKey",
  "adminUnlockUntil",
];

// Once a second game has kicked off, picks are settled for the week. Before
// that we keep re-reading them, which leaves room for the admin to hand
// someone a late pick after they miss the Thursday night game.
const GAMES_STARTED_BEFORE_PICKS_SETTLE = 2;

// Shapes an ESPN scoreboard payload into the maps this page renders from.
// Shared so the server-rendered first paint and the client refreshes can't
// drift apart.
function parseScoreboard(espnData) {
  const eventMap = {};
  const winners = {};

  for (const event of espnData?.events || []) {
    const comp = event?.competitions?.[0];
    const comps = comp?.competitors || [];
    const homeComp = comps.find((c) => c.homeAway === "home");
    const awayComp = comps.find((c) => c.homeAway === "away");

    const home = homeComp?.team;
    const away = awayComp?.team;

    eventMap[event.id] = {
      date: event.date ?? null,
      status: comp?.status?.type?.state ?? null,
      period: comp?.status?.period ?? null,
      displayClock: comp?.status?.displayClock ?? null,
      home: {
        abbr: home?.abbreviation || home?.shortDisplayName || "—",
        logo: home?.logo ?? null,
        short: home?.shortDisplayName ?? null,
      },
      away: {
        abbr: away?.abbreviation || away?.shortDisplayName || "—",
        logo: away?.logo ?? null,
        short: away?.shortDisplayName ?? null,
      },
      homeScore: homeComp?.score != null ? Number(homeComp.score) : null,
      awayScore: awayComp?.score != null ? Number(awayComp.score) : null,
    };

    if (comp?.status?.type?.state === "post") {
      const w = comps.find((c) => c.winner);
      if (w) winners[event.id] = w.team.shortDisplayName;
    }
  }

  return { eventMap, winners };
}

// The scoreboard and the week label need no auth, so resolve them on the
// server: the header, game columns and progress bar are then in the first
// paint instead of waiting on auth to restore and a client round trip.
// It also means router.query is already populated on first render.
export async function getServerSideProps(context) {
  const { year, week, season } = context.query;
  const seasontype = TYPE_MAP[season] ?? 2;

  // Identical for every viewer — the scoreboard and week label, both derived
  // from the URL. Participant rows load client-side after auth, so there's
  // nothing user-specific in this response and the CDN can serve it.
  context.res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=300");

  try {
    const [{ data }, weekLabel] = await Promise.all([
      getScoreboard({ year, week, seasontype }),
      getWeekLabel({ year, season: season || "reg", week }),
    ]);
    const { eventMap, winners } = parseScoreboard(data);
    return {
      props: {
        year: String(year),
        week: String(week),
        season: String(season || "reg"),
        ssrEventMap: eventMap,
        ssrWinners: winners,
        weekLabelSsr: weekLabel ?? null,
      },
    };
  } catch (e) {
    // Never fail the page on this — the client refresh will fill it in.
    console.error("results SSR prefetch failed", e);
    return {
      props: {
        year: String(year),
        week: String(week),
        season: String(season || "reg"),
        ssrEventMap: {},
        ssrWinners: {},
        weekLabelSsr: null,
      },
    };
  }
}

// A decided game with equal scores is a tie — no winner gets recorded for
// it, so nobody's pick counts as correct or incorrect for that game.
const isGameTied = (g) =>
  g?.status === "post" && g?.homeScore != null && g?.awayScore != null && g.homeScore === g.awayScore;

// Reusable widths so table scrolls instead of crushing cells
const W_USER = "w-[168px] min-w-[168px]";     // ~14ch
const W_WINS = "w-[56px]  min-w-[56px]";
const W_GAME = "w-[64px]  min-w-[64px] md:w-[80px] md:min-w-[80px]";
const W_TB   = "w-[72px]  min-w-[72px]";

export default function ScoresPage({ year, week, season, ssrEventMap, ssrWinners, weekLabelSsr }) {
  const weekLabel = useWeekLabel(year, season, week, weekLabelSsr);

  const [state, setState] = useState({
    loading: true,
    submissions: [],
    // Seeded from the server so the scoreboard is on screen immediately;
    // only the participant rows wait on Firestore.
    eventMap: ssrEventMap || {},
    winners: ssrWinners || {},
  });
  const { loading, submissions, eventMap, winners } = state;

  const [lastUpdated, setLastUpdated] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

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

  // Landscape: clicking a user's name shows their "Path to 1st" in a modal
  // (the portrait view already shows this inline via row expand)
  const [pathToFirstUid, setPathToFirstUid] = useState(null);

  const pollTimer = useRef(null);

  const keyNew = `${year}-${season}-W${week}`;

  const REFRESH_INTERVAL = 60_000;

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
    // Pick docs stop changing once the week is underway (see the constant
    // above), so we hold them after that instead of re-reading every user's
    // doc each refresh. Display names are re-read every time so a rename
    // shows up straight away.
    let cachedPicks = null;

    const buildPicks = (weeksSnap) =>
      weeksSnap.docs.map((docSnap) => {
        const userData = docSnap.data();
        return {
          uid: docSnap.ref.parent.parent.id,
          // Kept as a fallback for accounts whose profile doc is gone.
          storedName: userData.displayName || null,
          picks: Object.entries(userData)
            .filter(([k]) => !PICK_DOC_SYSTEM_FIELDS.includes(k))
            .map(([eventID, team]) => ({ eventID, teamName: team })),
          tieBreaker: userData.tieBreaker || "",
        };
      });

    const withCurrentNames = (picks, nameMap) =>
      picks.map((p) => ({
        ...p,
        displayName: nameMap.get(p.uid) || p.storedName || "Unknown",
      }));

    const run = async ({ refreshPicks = false } = {}) => {
      const needPicks = refreshPicks || !cachedPicks;

      try {
        const seasontype = TYPE_MAP[season] ?? 2;
        const apiUrl = `/api/scoreboard?seasontype=${seasontype}&week=${week}&year=${year}`;

        const [espnData, weeksSnap, nameMap] = await Promise.all([
          fetch(apiUrl).then((r) => r.json()),
          needPicks
            ? getDocs(query(collectionGroup(db, "weeks"), where("weekKey", "==", keyNew)))
            : null,
          fetchDisplayNameMap(),
        ]);

        if (cancelled) return;

        if (needPicks) cachedPicks = buildPicks(weeksSnap);
        const picks = withCurrentNames(cachedPicks, nameMap);

        const { eventMap: tempMap, winners: winnerMap } = parseScoreboard(espnData);

        const enriched = picks.map((entry) => {
          const picksMap = new Map(entry.picks.map((p) => [p.eventID, p.teamName]));
          const winnerCount = Object.keys(tempMap).reduce(
            (acc, id) => acc + (winnerMap[id] && winnerMap[id] === picksMap.get(id) ? 1 : 0),
            0
          );
          return { ...entry, winnerCount, picksMap };
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
        setLoadError(false);
        setLastUpdated(new Date());

        // Keep polling while any game is unfinished; stop once the week is
        // final, and pause while the tab is hidden (resumed by the listener
        // below) rather than refreshing in the background for nobody.
        const started = Object.values(tempMap).filter(
          (g) => g.status === "in" || g.status === "post"
        ).length;
        const anyUnfinished = Object.values(tempMap).some((g) => g.status !== "post");

        if (anyUnfinished && !cancelled && !document.hidden) {
          pollTimer.current = setTimeout(
            () => run({ refreshPicks: started < GAMES_STARTED_BEFORE_PICKS_SETTLE }),
            REFRESH_INTERVAL
          );
        }
      } catch (err) {
        console.error("Failed to load results", err);
        if (cancelled) return;
        setLoadError(true);
        setState((s) => ({ ...s, loading: false }));
      }
    };

    // Returning to a backgrounded tab should show current scores right away
    // instead of waiting out a poll interval.
    const onVisibilityChange = () => {
      if (cancelled || document.hidden) return;
      clearTimeout(pollTimer.current);
      run();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    run({ refreshPicks: true });

    return () => {
      cancelled = true;
      clearTimeout(pollTimer.current);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [year, week, season, authReady, reloadKey]);

  const uniqueEventIDs = useMemo(() => {
    return Object.keys(eventMap).sort(
      (a, b) => new Date(eventMap[a].date) - new Date(eventMap[b].date)
    );
  }, [eventMap]);

  const remainingEventIDs = useMemo(
    () => uniqueEventIDs.filter((id) => eventMap[id]?.status !== "post"),
    [uniqueEventIDs, eventMap]
  );

  // Shared lookup maps for the "Path to 1st" checks below, built once per
  // data refresh instead of once per expanded user per render.
  const picksByUid = useMemo(
    () => new Map(submissions.map((s) => [s.uid, new Map(s.picks.map((p) => [p.eventID, p.teamName]))])),
    [submissions]
  );
  const decidedByUid = useMemo(() => new Map(submissions.map((s) => [s.uid, s.winnerCount])), [submissions]);

  // Top-2 win counts let computeQuickStatus answer "what's the max among
  // everyone ELSE" in O(1) per user instead of re-scanning all users.
  const topTwoWinCounts = useMemo(() => {
    let first = { uid: null, wins: -Infinity };
    let second = { uid: null, wins: -Infinity };
    for (const s of submissions) {
      if (s.winnerCount > first.wins) {
        second = first;
        first = { uid: s.uid, wins: s.winnerCount };
      } else if (s.winnerCount > second.wins) {
        second = { uid: s.uid, wins: s.winnerCount };
      }
    }
    return [first, second];
  }, [submissions]);

  // Cheap O(1)-per-user math elimination/clinch check, no combinatorics: a
  // user's guaranteed floor is their current wins (remaining games can only
  // help), and their ceiling is current wins + every remaining game. Works
  // regardless of how many games remain, so it runs even when the full
  // brute-force breakdown below is gated off by MAX_SCENARIO_GAMES. Note
  // this is a conservative (necessary but not sufficient) test — e.g. two
  // users with identical remaining picks have an invariant gap that this
  // check alone won't catch, which is exactly what the brute-force pass
  // below is for.
  const computeQuickStatus = useCallback(
    (targetUid) => {
      const targetWins = decidedByUid.get(targetUid);
      if (targetWins == null) return null;
      const remainingCount = remainingEventIDs.length;
      const targetFloor = targetWins;
      const targetCeiling = targetWins + remainingCount;

      const [first, second] = topTwoWinCounts;
      const maxOtherFloor = first.uid === targetUid ? second.wins : first.wins;
      const maxOtherCeiling = maxOtherFloor === -Infinity ? -Infinity : maxOtherFloor + remainingCount;

      if (maxOtherFloor === -Infinity) return "locked"; // sole participant
      if (targetFloor > maxOtherCeiling) return "locked";
      if (targetCeiling < maxOtherFloor) return "eliminated";
      return null; // still ambiguous — needs the detailed breakdown
    },
    [decidedByUid, remainingEventIDs, topTwoWinCounts]
  );

  // The tiebreaker is the combined final score of the week's last-kickoff
  // game. If that game is already final, its actual score is known and ties
  // resolve deterministically; if it's still remaining, we know WHO wins
  // each hypothetical outcome but not the final score, so a tie in that
  // scenario stays "alive but pending the tiebreaker" rather than resolved.
  const tiebreakerEventID = uniqueEventIDs[uniqueEventIDs.length - 1];
  const tiebreakerGame = eventMap[tiebreakerEventID];
  const tiebreakerDecided = tiebreakerGame?.status === "post";
  const actualTiebreakerScore = tiebreakerDecided
    ? (tiebreakerGame.homeScore ?? 0) + (tiebreakerGame.awayScore ?? 0)
    : null;
  const tiebreakerGuessByUid = useMemo(
    () => new Map(submissions.map((s) => [s.uid, Number(s.tieBreaker)])),
    [submissions]
  );

  // Enumerates every possible outcome of the remaining games to find which
  // ones let this user finish 1st (or tie for it), then summarizes the
  // outcomes required in every winning scenario. Capped at MAX_SCENARIO_GAMES
  // remaining games (16 combinations) to stay cheap and to avoid showing
  // noise early in the week when nothing is meaningfully decidable yet.
  const buildScenario = useCallback(
    (targetUid) => {
      if (remainingEventIDs.length === 0 || remainingEventIDs.length > MAX_SCENARIO_GAMES) return null;

      const totalCombos = 2 ** remainingEventIDs.length;
      // Per-mask outcome for every possible combo, not just the winning ones —
      // needed to tell "this game could go either way and it's irrelevant"
      // apart from "this game could go either way and it genuinely matters."
      const isWin = new Array(totalCombos);
      const requiresTB = new Array(totalCombos);
      const tiedGroups = new Array(totalCombos);

      for (let mask = 0; mask < totalCombos; mask++) {
        const assignment = {};
        remainingEventIDs.forEach((id, i) => {
          const g = eventMap[id];
          const homeWins = (mask >> i) & 1;
          assignment[id] = homeWins ? g?.home?.short : g?.away?.short;
        });

        let maxWins = -Infinity;
        const winsByUid = new Map();
        for (const s of submissions) {
          const picks = picksByUid.get(s.uid);
          let wins = decidedByUid.get(s.uid) || 0;
          for (const id of remainingEventIDs) {
            if (picks.get(id) === assignment[id]) wins++;
          }
          winsByUid.set(s.uid, wins);
          if (wins > maxWins) maxWins = wins;
        }

        const tied = [...winsByUid.entries()].filter(([, wins]) => wins === maxWins).map(([uid]) => uid);

        let winnerUids;
        let needsTB = false;
        if (tied.length === 1) {
          winnerUids = tied;
        } else if (tiebreakerDecided) {
          // Score is known — resolve the tie for real, no future dependency.
          // Closest guess that's >= the actual score wins (has to "cover"
          // it); if everyone undershoots, the highest guess wins (smallest
          // shortfall). Same rule as the backend's buildWinners in
          // functions/index.js — this used to be plain closest-absolute-
          // difference, which is a different (wrong) rule entirely.
          const withDiff = tied.map((uid) => {
            const guess = tiebreakerGuessByUid.get(uid);
            if (!Number.isFinite(guess)) return { uid, absDiff: Infinity, under: true };
            const diff = guess - actualTiebreakerScore;
            return { uid, absDiff: Math.abs(diff), under: diff < 0 };
          });
          const covering = withDiff.filter((x) => !x.under);
          const pool = covering.length ? covering : withDiff;
          const minAbs = Math.min(...pool.map((x) => x.absDiff));
          winnerUids = pool.filter((x) => x.absDiff === minAbs).map((x) => x.uid);
        } else {
          // Tiebreaker game hasn't happened yet — anyone tied is still alive
          winnerUids = tied;
          needsTB = true;
        }

        isWin[mask] = winnerUids.includes(targetUid);
        requiresTB[mask] = needsTB;
        tiedGroups[mask] = tied;
      }

      const winningMasks = [];
      for (let mask = 0; mask < totalCombos; mask++) if (isWin[mask]) winningMasks.push(mask);

      if (winningMasks.length === 0) return { status: "eliminated" };
      if (winningMasks.length === totalCombos && winningMasks.every((m) => !requiresTB[m])) {
        return { status: "locked" };
      }

      // A game is "relevant" if flipping it (holding everything else fixed)
      // ever changes the win/lose outcome. If it's never decisive — e.g. two
      // users share the same pick, so the gap between them never moves —
      // drop it from the explanation entirely instead of treating it as
      // ambiguity.
      const relevantIdx = [];
      remainingEventIDs.forEach((id, i) => {
        const bit = 1 << i;
        for (let mask = 0; mask < totalCombos; mask++) {
          if ((mask & bit) === 0 && isWin[mask] !== isWin[mask | bit]) {
            relevantIdx.push(i);
            break;
          }
        }
      });

      const assignmentOf = (mask) => {
        const a = {};
        remainingEventIDs.forEach((id, i) => {
          const g = eventMap[id];
          a[id] = (mask >> i) & 1 ? g?.home?.short : g?.away?.short;
        });
        return a;
      };

      // Among relevant games, one that has the same required value in every
      // winning combo is a hard requirement; the rest form genuine OR logic.
      const necessary = [];
      const flexibleIdx = [];
      for (const i of relevantIdx) {
        const id = remainingEventIDs[i];
        const values = new Set(winningMasks.map((m) => assignmentOf(m)[id]));
        if (values.size === 1) {
          const g = eventMap[id];
          const needShort = [...values][0];
          const needHome = needShort === g?.home?.short;
          necessary.push({
            needAbbr: needHome ? g?.home?.abbr : g?.away?.abbr,
            overAbbr: needHome ? g?.away?.abbr : g?.home?.abbr,
          });
        } else {
          flexibleIdx.push(i);
        }
      }

      const needsTiebreaker = winningMasks.every((m) => requiresTB[m]);
      // Who targetUid would be tied with in the tiebreaker, for the specific
      // scores-range messaging below. The guesses being compared are fixed
      // regardless of how the remaining games go, so any winning+needsTB
      // mask's tied group is a representative sample of who that is.
      const tiebreakGroup = needsTiebreaker
        ? tiedGroups[winningMasks.find((m) => requiresTB[m])]
        : null;

      // Spell out the actual valid combinations for whatever's left flexible,
      // restricted to just those games (necessary/irrelevant ones excluded)
      const flexibleOptions =
        flexibleIdx.length > 0
          ? [
              ...new Set(
                winningMasks.map((m) => {
                  const a = assignmentOf(m);
                  return flexibleIdx
                    .map((i) => {
                      const id = remainingEventIDs[i];
                      const g = eventMap[id];
                      return a[id] === g?.home?.short ? g?.home?.abbr : g?.away?.abbr;
                    })
                    .join(" & ");
                })
              ),
            ]
          : [];

      return {
        status: "conditional",
        necessary,
        needsTiebreaker,
        flexibleOptions,
        tiebreakGroup,
      };
    },
    [
      remainingEventIDs,
      submissions,
      eventMap,
      picksByUid,
      decidedByUid,
      tiebreakerDecided,
      actualTiebreakerScore,
      tiebreakerGuessByUid,
    ]
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

  const hasScoreboard = Object.keys(eventMap).length > 0;

  if (loadError && !lastUpdated && !hasScoreboard) {
    return (
      <div className="p-6 text-center">
        <p className="mb-3 text-sm text-red-600 dark:text-red-400">Couldn&apos;t load results.</p>
        <button
          onClick={() => setReloadKey((k) => k + 1)}
          className="px-4 py-2 rounded-lg bg-slate-800 text-white text-sm font-semibold"
        >
          Try again
        </button>
      </div>
    );
  }

  if (loading && !lastUpdated && !hasScoreboard) return <div className="p-6 text-center">Loading...</div>;

  const borderClass = "border border-gray-300";
  const truncate14 = (str) => (!str ? "" : str.length > 14 ? `${str.slice(0, 13)}…` : str);
  const joinWithAnd = (arr) =>
    arr.length <= 1 ? arr.join("") : `${arr.slice(0, -1).join(", ")}${arr.length > 2 ? "," : ""} and ${arr[arr.length - 1]}`;

  // The actual winning combined-score range for one person in a tiebreaker
  // group — not just "you must win the tiebreaker" but the specific numbers.
  // Same rule as buildScenario's tie resolution and the backend's
  // buildWinners: closest guess >= the actual score wins, so each person's
  // band runs from just above the next-lower guess up to (and including)
  // their own — except whoever has the single highest guess, whose band has
  // no upper limit, since nobody's guess covers a higher score than theirs.
  const describeTiebreakBand = (tiedUids, targetUid) => {
    const entries = tiedUids
      .map((uid) => ({ uid, guess: tiebreakerGuessByUid.get(uid) }))
      .filter((e) => Number.isFinite(e.guess))
      .sort((a, b) => a.guess - b.guess);

    const idx = entries.findIndex((e) => e.uid === targetUid);
    if (idx === -1) return null; // target has no valid guess to anchor a band to

    const own = entries[idx].guess;
    const isTop = idx === entries.length - 1;
    const lower = idx === 0 ? null : entries[idx - 1].guess + 1;

    if (isTop && lower == null) return `the tiebreaker score`; // sole tiebreaker guess — always covers
    if (isTop) return `${lower} or higher`;
    if (lower == null) return `${own} or lower`;
    if (lower === own) return `${own}`;
    if (lower === own - 1) return `${lower} or ${own}`;
    return `${lower}–${own}`;
  };

  // Shared by both the portrait inline callout and the landscape click-through
  // modal. Returns null when there's nothing to show (week fully decided).
  const getPathToFirst = (uid) => {
    if (remainingEventIDs.length === 0) return null;

    const quickStatus = computeQuickStatus(uid);

    if (quickStatus === null && remainingEventIDs.length > MAX_SCENARIO_GAMES) {
      return { kind: "guardrail", text: `unlocks once ${MAX_SCENARIO_GAMES} or fewer games remain this week.` };
    }

    if (quickStatus === "locked") return { kind: "verdict", text: "🔒 Locked in for 1st place this week!" };
    if (quickStatus === "eliminated") return { kind: "verdict", text: "Eliminated from 1st place this week." };

    const scenario = buildScenario(uid);
    if (!scenario) return null;

    if (scenario.status === "locked") return { kind: "verdict", text: "🔒 Locked in for 1st place this week!" };
    if (scenario.status === "eliminated") return { kind: "verdict", text: "Eliminated from 1st place this week." };

    const teamAbbrs = scenario.necessary.map((n) => n.needAbbr);
    const clauses = [];
    if (teamAbbrs.length > 0) clauses.push(`${joinWithAnd(teamAbbrs)} must win`);
    if (scenario.needsTiebreaker) {
      const band = scenario.tiebreakGroup && describeTiebreakBand(scenario.tiebreakGroup, uid);
      const tbMatchup =
        tiebreakerGame?.away?.abbr && tiebreakerGame?.home?.abbr
          ? ` in the tiebreaker game (${tiebreakerGame.away.abbr} @ ${tiebreakerGame.home.abbr})`
          : "";
      clauses.push(
        band
          ? `your combined score must be ${band}${tbMatchup}`
          : "you must win the tiebreaker" // fallback if the band couldn't be computed (e.g. no valid guess)
      );
    }

    const orText =
      scenario.flexibleOptions.length > 0
        ? `at least one of: ${scenario.flexibleOptions.map((opt) => `(${opt.split(" & ").join(" and ")})`).join(" or ")}`
        : "";

    // Branch strictly on whether there's actually flexible-option text to
    // append — "fullyDetermined" used to gate this instead, but it's false
    // whenever needsTiebreaker is true regardless of whether orText is
    // empty, which produced "you must win the tiebreaker — plus ." with
    // nothing after "plus" whenever the tiebreaker was the only remaining
    // condition and no either/or games were left.
    let text;
    if (clauses.length === 0 && !orText) {
      text = "Path depends on how the remaining games go — several combinations could work in your favor.";
    } else if (clauses.length > 0 && orText) {
      text = `${joinWithAnd(clauses)} — plus ${orText}.`;
    } else if (clauses.length > 0) {
      text = `${joinWithAnd(clauses)} to finish 1st.`;
    } else {
      text = `${orText} to finish 1st.`;
    }
    // No "Needs:" prefix anymore — the "Path to 1st" label already says
    // what this is. But clauses/orText both start lowercase ("you must
    // win…", "at least one of…"), so capitalize the sentence itself now
    // that nothing precedes it.
    text = text.charAt(0).toUpperCase() + text.slice(1);

    return { kind: "verdict", text };
  };

  // Path to 1st callout + the color-coded game-by-game pick grid for one
  // user. Shared by the compact card list's inline expand AND the desktop
  // table's "click a name" modal, so the two are guaranteed to actually
  // match instead of being two copies that can quietly drift apart.
  const renderUserBreakdown = (entry) => {
    const picksMap = entry.picksMap;
    const p2f = getPathToFirst(entry.uid);

    return (
      <>
        {p2f && (
          <div
            className={`mb-2 rounded-md px-3 py-2 text-sm sm:text-base leading-snug ${
              p2f.kind === "guardrail"
                ? "bg-slate-100 dark:bg-zinc-800 text-gray-600 dark:text-gray-400"
                : "bg-indigo-50 dark:bg-indigo-950 border border-indigo-200 dark:border-indigo-800 text-indigo-900 dark:text-indigo-100"
            }`}
          >
            <span className="font-bold uppercase tracking-wide">Path to 1st: </span>
            {p2f.text}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2.5">
          {uniqueEventIDs.map((eventID) => {
            const g = eventMap[eventID];
            const pickTeam = picksMap.get(eventID);
            const correct = winners[eventID] === pickTeam;
            const pickedHome = g?.home?.abbr === pickTeam || g?.home?.short === pickTeam;
            const team = pickedHome
              ? { logo: g?.home?.logo, label: g?.home?.abbr }
              : { logo: g?.away?.logo, label: g?.away?.abbr };
            const isPending = g?.status !== "post";
            const isLive = g?.status === "in";
            const bgColor = isPending
              ? "bg-slate-200 dark:bg-zinc-700 text-slate-900 dark:text-white"
              : isGameTied(g)
              ? "bg-sky-300 text-slate-900"
              : correct
              ? "bg-emerald-300 text-slate-900"
              : "bg-rose-300 text-slate-900";
            const liveRing = isLive ? "ring-2 ring-blue-500" : "";

            return (
              <div
                key={eventID}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedGameID(eventID);
                }}
                className={`flex items-center justify-center gap-2 rounded-lg px-2 py-2 min-h-[44px] cursor-pointer active:opacity-80 ${bgColor} ${liveRing}`}
              >
                {pickTeam && team?.logo ? (
                  <Image src={team.logo} alt={team?.label || "Team"} width={30} height={30} className="shrink-0" />
                ) : (
                  <span className="text-gray-400 w-8 text-center">–</span>
                )}
                <span className="text-base font-extrabold font-mono truncate">
                  {team?.label || "—"}
                </span>
              </div>
            );
          })}
        </div>
      </>
    );
  };

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
        <title>{weekLabel ? `${weekLabel} Scores` : "Scores"}</title>
      </Head>

      {/* Header (same width feel as table via centered container) */}
      <section className="max-w-8xl mx-auto mb-4 px-1 sm:px-0">
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
          {weekLabel || "Scores"}
        </h1>

        <div className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {submissions.length} total participants
          {" • "}
          {lastUpdated ? `Last Updated ${lastUpdated.toLocaleTimeString()}` : "—"}
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

      {/* Table (landscape / wide screens)
          Vertical scroll is just the normal page scroll now — same as every
          other page in the app, including the portrait table below. It used
          to be bounded to a max-h-[80vh] box so the header row could stick
          to the TOP of that box reliably. But mobile browsers don't compute
          "vh" consistently (it shifts with the address bar), and the page
          itself was never prevented from also scrolling — so you got two
          competing scroll regions fighting over the same swipe, which is
          exactly the "alternates between mobile and browser scrolling" bug.
          Only the horizontal axis is its own scroll container here now; the
          frozen User/Wins columns (sticky left-*) are unaffected — that part
          was already fine and is left exactly as-is. */}
      {/* Which view shows is based on actual device orientation now, not a
          width breakpoint. A width cutoff conflated "wide viewport" with
          "desktop" — a phone or iPad rotated to landscape has plenty of
          width and should still get this table, which a fixed px cutoff
          (previously sm, then overcorrected to 2xl) can't express either
          direction: sm caught portrait iPads that wanted the compact list,
          2xl excluded landscape phones that wanted this table. */}
      <div className="hidden landscape:block max-w-8xl mx-auto mb-28 overflow-x-auto">
        {/* min-w-max => table grows to fit columns; wrapper scrolls on small screens */}
        <table className={`min-w-max w-full text-base border-separate border-spacing-0 ${borderClass}`}>
          <thead className="bg-slate-800 text-white shadow-sm">
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
                  <th key={id} className={`${W_GAME} px-1 py-1 text-center font-bold bg-slate-800 ${borderClass}`}>
                    <HeaderCompact g={g} showScores={showScore} />
                  </th>
                );
              })}

              <th className={`${W_TB} px-2 py-1 text-center font-bold bg-slate-800 ${borderClass}`}>TB</th>
            </tr>
          </thead>

          <tbody>
            {submissions.length === 0 && (
              <tr>
                <td colSpan={uniqueEventIDs.length + 3} className="px-3 py-4 text-center text-sm text-gray-500 dark:text-gray-400">
                  {loadError ? "Couldn't load picks." : "Loading picks…"}
                </td>
              </tr>
            )}
            {submissions.map((entry, index) => {
              const rowBg = index % 2 === 0 ? "bg-white dark:bg-zinc-900" : "bg-gray-50 dark:bg-zinc-800";
              const picksMap = entry.picksMap;

              return (
                <tr key={entry.uid} className={rowBg}>
                  <td
                    className={`${W_USER} py-1 sticky left-0 z-10 font-bold ${rowBg} ${borderClass} truncate whitespace-nowrap cursor-pointer hover:underline`}
                    style={{ paddingLeft: "max(0.5rem, env(safe-area-inset-left))", paddingRight: "0.5rem" }}
                    title="View Path to 1st"
                    onClick={() => setPathToFirstUid(entry.uid)}
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
                    const bgColor = isPending
                      ? ""
                      : isGameTied(g)
                      ? "bg-blue-200"
                      : correct
                      ? "bg-green-200"
                      : "bg-red-200";

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
      <div className="landscape:hidden max-w-8xl mx-auto pb-28">
        <table className={`w-full text-base border-separate border-spacing-0 ${borderClass}`}>
          <thead className="bg-slate-800 text-white shadow-sm">
            <tr>
              <th className={`w-[48px] px-2 py-1 text-center font-bold ${borderClass}`}>Rank</th>
              <th className={`py-1 text-left font-bold ${borderClass}`} style={{ paddingLeft: "0.5rem" }}>
                User
              </th>
              <th className={`w-[56px] px-2 py-1 text-center font-bold ${borderClass}`}>Wins</th>
            </tr>
          </thead>

          <tbody>
            {submissions.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-4 text-center text-sm text-gray-500 dark:text-gray-400">
                  {loadError ? "Couldn't load picks." : "Loading picks…"}
                </td>
              </tr>
            )}
            {submissions.map((entry, index) => {
              const rowBg = index % 2 === 0 ? "bg-white dark:bg-zinc-900" : "bg-gray-50 dark:bg-zinc-800";
              const isOpen = expandedUsers.has(entry.uid);

              return (
                <Fragment key={entry.uid}>
                  <tr
                    className={`${rowBg} cursor-pointer`}
                    onClick={() => toggleExpanded(entry.uid)}
                  >
                    <td className={`w-[48px] px-2 py-1 text-center font-bold ${rowBg} ${borderClass}`}>
                      {entry.rank}
                    </td>
                    <td
                      className={`py-1 font-bold ${rowBg} ${borderClass} truncate whitespace-nowrap`}
                      style={{ paddingLeft: "0.5rem" }}
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
                  </tr>

                  {isOpen && (
                    <tr className={rowBg}>
                      <td colSpan={3} className={`${borderClass} p-2`}>
                        {renderUserBreakdown(entry)}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* All picks for one game, opened by tapping a game box inside either
          the compact card list or the desktop "everyone's picks" modal below —
          no longer sm:hidden, since it's reachable from both now. */}
      {selectedGameID && (() => {
        const g = eventMap[selectedGameID];
        if (!g) return null;
        const isDecided = g.status === "post";
        const isLiveGame = g.status === "in";
        const showScore = isDecided || isLiveGame;
        // Tiebreaker is the combined score of the week's last-kickoff game
        const isTiebreakerGame = selectedGameID === uniqueEventIDs[uniqueEventIDs.length - 1];

        return (
          // Can be opened from inside the user-breakdown modal below (tap a
          // game there), so it needs to sit strictly above it — z-[70] vs
          // that modal's z-[60] — otherwise two stacked semi-transparent
          // backdrops just show the lower one dimmed through the top one
          // rather than fully covering it. Centered instead of a bottom
          // sheet now that it isn't mobile-only.
          <div
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"
            onClick={() => setSelectedGameID(null)}
          >
            <div
              className="w-full max-w-md max-h-[80vh] overflow-y-auto rounded-2xl bg-white dark:bg-zinc-900 text-gray-900 dark:text-white p-4"
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
                    : isGameTied(g)
                    ? "bg-blue-200 dark:bg-blue-300 text-gray-900"
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

      {/* Desktop table: clicking a user's name shows the same game-by-game
          breakdown as the compact card list's inline expand, in a modal
          instead (a row in this table doesn't have room to expand in
          place). Used to only show the Path to 1st text — now consistent
          with the compact view everywhere. */}
      {pathToFirstUid && (() => {
        const entry = submissions.find((s) => s.uid === pathToFirstUid);
        if (!entry) return null;

        return (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
            onClick={() => setPathToFirstUid(null)}
          >
            <div
              className="w-full max-w-md max-h-[85vh] overflow-y-auto rounded-2xl bg-white dark:bg-zinc-900 text-gray-900 dark:text-white p-5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="font-bold text-lg">{entry.displayName}</div>
                <button
                  onClick={() => setPathToFirstUid(null)}
                  className="px-3 py-1.5 rounded-md bg-slate-100 dark:bg-zinc-800 text-sm font-semibold"
                >
                  Close
                </button>
              </div>

              {renderUserBreakdown(entry)}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
