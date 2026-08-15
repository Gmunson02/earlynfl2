import { useRouter } from "next/router";
import Head from "next/head";
import { useEffect, useMemo, useRef, useState } from "react";
import { LazyMotion, domAnimation, m as motion } from "framer-motion";
import { RefreshCw } from "lucide-react";
import Image from "next/image";
import { auth, db } from "../../../../lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import GameDetailModal from "../../../../components/GameDetailModal";

const TYPE_MAP = { pre: 1, reg: 2, post: 3 };
const DOWN_NAMES = { 1: "1st", 2: "2nd", 3: "3rd", 4: "4th" };

// Adaptive intervals
const LIVE_INTERVAL = 20_000; // 20s during live games
const IDLE_INTERVAL = 90_000; // 90s when idle

export default function GameCenter() {
  const router = useRouter();
  const { year, week, season: seasonRaw } = router.query;

  // normalize season (default to "reg")
  const season = useMemo(() => {
    const s = Array.isArray(seasonRaw) ? seasonRaw[0] : seasonRaw;
    const v = String(s || "").toLowerCase();
    return v === "pre" || v === "reg" || v === "post" ? v : "reg";
  }, [seasonRaw]);

  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reloadTick, setReloadTick] = useState(0);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [isVisible, setIsVisible] = useState(true);
  const [myPicks, setMyPicks] = useState({});
  const [selectedGame, setSelectedGame] = useState(null);

  // Load the signed-in user's picks for this week so we can highlight them
  useEffect(() => {
    if (!year || !week) return;
    const weekKey = `${year}-${season}-W${week}`;
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setMyPicks({});
        return;
      }
      try {
        const snap = await getDoc(doc(db, "picks", user.uid, "weeks", weekKey));
        setMyPicks(snap.exists() ? snap.data() : {});
      } catch {
        setMyPicks({});
      }
    });
    return unsub;
  }, [year, week, season]);

  const lastKeyRef = useRef(""); // for change detection
  const timeoutRef = useRef(null); // adaptive timer

  // Include seconds
  // "8/15 - 4 PM ET" / "8/15 - 4:30 PM ET" — always Eastern, always this shape
  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat("en-US", { month: "numeric", day: "numeric", timeZone: "America/New_York" }),
    []
  );
  const kickoffTimeFmt = useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
        timeZone: "America/New_York",
      }),
    []
  );
  const formatKickoff = (dateStr) => {
    const d = new Date(dateStr);
    const time = kickoffTimeFmt.format(d).replace(":00 ", " ");
    return `${dateFmt.format(d)} - ${time} ET`;
  };
  const cacheKeyLS = useMemo(() => {
    if (!year || !week) return null;
    return `gc-cache-${year}-${season}-${week}`;
  }, [year, week, season]);

  const stableKeyFromEvents = (events) => {
    // Only include fields we render
    const slim = events.map((e) => {
      const c = e?.competitions?.[0] || {};
      const home = c?.competitors?.find((x) => x.homeAway === "home");
      const away = c?.competitors?.find((x) => x.homeAway === "away");
      return {
        id: e.id,
        date: e.date,
        st: c?.status?.type?.state,
        period: c?.status?.period,
        clock: c?.status?.displayClock,
        hs: home?.score,
        as: away?.score,
        poss: c?.situation?.possession,
        dd: c?.situation?.shortDownDistanceText || c?.situation?.downDistanceText,
        yl: c?.situation?.yardLineText,
        odds: c?.odds?.[0]?.details,
        ou: c?.odds?.[0]?.overUnder,
      };
    });
    return JSON.stringify(slim);
  };

  const sortEvents = (events) => {
    // Group: 0 = current or unplayed, 1 = finished
    const groupRank = (evt) => {
      const st = evt?.competitions?.[0]?.status?.type?.state;
      return st === "post" ? 1 : 0;
    };
    const ts = (evt) => {
      const t = new Date(evt?.date || 0).getTime();
      return Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER;
    };
    return events
      .map((e) => ({ e, g: groupRank(e), t: ts(e) }))
      .sort((a, b) => (a.g - b.g) || (a.t - b.t) || String(a.e.id).localeCompare(String(b.e.id)))
      .map((x) => x.e);
  };

  const fetchGames = async (signal) => {
    if (!year || !week) return;
    setLoading(true);
    try {
      const stype = TYPE_MAP[season];
      // cache-buster to avoid CDN/browser cache
      const url = `/api/scoreboard?year=${year}&week=${week}&seasontype=${stype}&_ts=${Date.now()}`;
      const res = await fetch(url, { signal, cache: "no-store" });
      const data = await res.json();
      const events = Array.isArray(data?.events) ? data.events : [];

      const sorted = sortEvents(events);
      const key = stableKeyFromEvents(sorted);

      if (key !== lastKeyRef.current) {
        lastKeyRef.current = key;
        setGames(sorted);
      }

      // Always tick "last updated" on a successful fetch, even if content didn't change
      setLastUpdated(new Date());

      // persist to localStorage for instant warm render
      if (cacheKeyLS) {
        try {
          localStorage.setItem(cacheKeyLS, JSON.stringify({ ts: Date.now(), events: sorted }));
        } catch {}
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        console.error("Failed to load games", err);
        // gentle retry in 30s on transient errors
        if (!timeoutRef.current) {
          timeoutRef.current = setTimeout(() => setReloadTick((n) => n + 1), 30_000);
        }
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  };

  // Load from localStorage immediately for instant paint
  useEffect(() => {
    if (!cacheKeyLS) return;
    try {
      const raw = localStorage.getItem(cacheKeyLS);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed?.events)) {
          setGames(parsed.events);
        }
      }
    } catch {}
  }, [cacheKeyLS]);

  // First fetch + manual refresh trigger
  useEffect(() => {
    if (!router.isReady || !year || !week) return;
    const controller = new AbortController();
    fetchGames(controller.signal);
    return () => controller.abort();
  }, [router.isReady, year, week, season, reloadTick]);

  // Track page visibility
  useEffect(() => {
    const fn = () => setIsVisible(document.visibilityState === "visible");
    fn();
    document.addEventListener("visibilitychange", fn);
    return () => document.removeEventListener("visibilitychange", fn);
  }, []);

  // Adaptive polling:
  // - live -> 20s
  // - idle -> 90s (but wake sooner if within 2 min of next kickoff)
  // - stop when all final
  useEffect(() => {
    if (!isVisible) return;

    // Clear any previous timer
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    const now = Date.now();
    const anyLive = games.some((g) => g?.competitions?.[0]?.status?.type?.state === "in");

    if (anyLive) {
      timeoutRef.current = setTimeout(() => setReloadTick((n) => n + 1), LIVE_INTERVAL);
      return () => clearTimeout(timeoutRef.current);
    }

    // No live: find earliest future kickoff
    const futureTs = games
      .map((g) => new Date(g.date).getTime())
      .filter((t) => Number.isFinite(t) && t > now)
      .sort((a, b) => a - b)[0];

    if (!futureTs) {
      // Nothing upcoming => everything is final (or data missing) -> stop polling
      return;
    }

    // Wake ~2 minutes before kickoff (but at least 10s from now), and no longer than 90s away
    const twoMin = 2 * 60 * 1000;
    const untilKick = futureTs - now - twoMin; // could be negative if < 2min left
    const computed = Math.max(10_000, untilKick); // at least 10s
    const delay = Math.min(IDLE_INTERVAL, computed); // cap to idle interval

    timeoutRef.current = setTimeout(() => setReloadTick((n) => n + 1), delay);
    return () => clearTimeout(timeoutRef.current);
  }, [games, isVisible]);

  const onRefresh = () => setReloadTick((n) => n + 1);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-gradient-to-tr dark:from-gray-950 dark:to-gray-900 text-zinc-900 dark:text-white px-6 py-4 pb-32">
      <Head>
        <title>
          Game Center | {String(year)} {season.toUpperCase()} • Week {String(week)}
        </title>
      </Head>

      <div className="max-w-5xl mx-auto">
        <header className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-extrabold">
             Week {String(week)}
            </h1>
            {lastUpdated && (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Last updated{" "}
                {lastUpdated.toLocaleTimeString([], {
                  hour: "numeric",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </p>
            )}
          </div>

          <button
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm font-medium hover:bg-zinc-100/60 dark:hover:bg-zinc-800/60 disabled:opacity-50"
            aria-label="Refresh games"
            title="Refresh"
          >
            <RefreshCw className={loading ? "animate-spin" : ""} size={16} />
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </header>

        {loading && !games.length ? (
          <p className="text-center text-zinc-500">Loading games...</p>
        ) : games.length === 0 ? (
          <p className="text-center text-zinc-500">No games found.</p>
        ) : (
          <LazyMotion features={domAnimation}>
            <div className="grid gap-4">
              {games.map((event) => {
                const comp = event?.competitions?.[0];
                const status = comp?.status || {};
                const stType = status?.type || {};
                const isLive = stType?.state === "in";
                const isPost = stType?.state === "post" || stType?.completed;

                const statusText = stType?.shortDetail || stType?.description || "";
                const odds = comp?.odds?.[0]?.details;
                const overUnder = comp?.odds?.[0]?.overUnder;
                const broadcast = comp?.broadcasts?.[0]?.names?.[0];

                const home = comp?.competitors?.find((x) => x.homeAway === "home");
                const away = comp?.competitors?.find((x) => x.homeAway === "away");

                const sit = comp?.situation || {};
                const possId = String(sit.possession || "");
                const teamHasPoss = (team) => String(team?.id || "") === possId;

                const scoreFor = (team) => (isLive || isPost ? team?.score : "--");

                // ESPN's situation object has no ready-made "3rd & 5" or
                // "on CHI 40" text — build it from the raw down/distance,
                // and convert situation.yardLine (0-100, own-goal-line to
                // opponent-goal-line) into "TEAM 40" text ourselves. Note:
                // lastPlay.end.text looked like it'd do this for free, but
                // it's only reliably populated for scoring plays.
                const downText =
                  sit.down >= 1 && sit.down <= 4 ? `${DOWN_NAMES[sit.down]} & ${sit.distance}` : "";
                const spotText = (() => {
                  if (sit.yardLine == null || !possId) return "";
                  if (sit.yardLine === 50) return "50";
                  const possIsAway = possId === String(away?.team?.id || "");
                  const possAbbr = possIsAway ? away?.team?.abbreviation : home?.team?.abbreviation;
                  const oppAbbr = possIsAway ? home?.team?.abbreviation : away?.team?.abbreviation;
                  return sit.yardLine < 50
                    ? `${possAbbr || ""} ${sit.yardLine}`.trim()
                    : `${oppAbbr || ""} ${100 - sit.yardLine}`.trim();
                })();

                const myPick = myPicks[event.id];
                const pickedAway = myPick && myPick === away?.team?.shortDisplayName;
                const pickedHome = myPick && myPick === home?.team?.shortDisplayName;

                return (
<motion.div
  key={event.id}
  initial={{ opacity: 0, y: 10 }}
  animate={{ opacity: 1, y: 0 }}
  onClick={() =>
    setSelectedGame({
      eventId: event.id,
      awayTeam: { id: away?.team?.id, abbr: away?.team?.abbreviation || away?.team?.shortDisplayName, logo: away?.team?.logo },
      homeTeam: { id: home?.team?.id, abbr: home?.team?.abbreviation || home?.team?.shortDisplayName, logo: home?.team?.logo },
      isLive,
      period: status?.period,
      clock: status?.displayClock,
      possessionTeamId: possId,
      downDistanceText: downText,
      yardLineText: spotText,
      isRedZone: sit.isRedZone,
      broadcast,
    })
  }
  role="button"
  tabIndex={0}
  className={`bg-white dark:bg-zinc-800/80 border rounded-xl shadow p-4 cursor-pointer hover:shadow-md transition-shadow ${
    isLive
      ? "border-blue-500 shadow-blue-500/20"
      : "border-zinc-200 dark:border-zinc-700"
  }`}
>
{/* TOP: left = live/status/kickoff, center = RED ZONE, right = network only */}
<div className="grid grid-cols-3 items-start mb-2">
  <div className="flex justify-start">
    {isLive ? (
      <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-blue-200 text-blue-900">
        LIVE
      </span>
    ) : (
      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
        {isPost ? statusText : formatKickoff(event.date)}
      </p>
    )}
  </div>
  <div className="flex justify-center">
    {isLive && sit.isRedZone && (
      <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-red-300 text-red-900">
        RED ZONE
      </span>
    )}
  </div>
  <div className="flex justify-end">
    {broadcast && !isPost && (
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{broadcast}</p>
    )}
  </div>
</div>

                    {/* SCORES (🏈 next to team with possession, ring on your pick) */}
                    <div className="flex justify-between items-center mb-2">
                      <div className="flex flex-col items-center">
                        {away?.team?.logo && (
                          <Image
                            src={away.team.logo}
                            alt={`${away?.team?.shortDisplayName || "Away"} logo`}
                            width={40}
                            height={40}
                            className={`rounded-full ${pickedAway ? "ring-2 ring-emerald-500" : ""}`}
                            loading="lazy"
                          />
                        )}
                        <div className="mt-1 flex items-center gap-1">
                          <p
                            className={`text-lg font-bold ${
                              isLive && Number(away?.score) > Number(home?.score) ? "text-green-600" : ""
                            }`}
                          >
                            {scoreFor(away)}
                          </p>
                          {isLive && teamHasPoss(away) && <span className="text-xs">🏈</span>}
                        </div>
                        {pickedAway && (
                          <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                            Your Pick
                          </span>
                        )}
                      </div>

                      <span className="text-lg font-bold text-zinc-500">@</span>

                      <div className="flex flex-col items-center">
                        {home?.team?.logo && (
                          <Image
                            src={home.team.logo}
                            alt={`${home?.team?.shortDisplayName || "Home"} logo`}
                            width={40}
                            height={40}
                            className={`rounded-full ${pickedHome ? "ring-2 ring-emerald-500" : ""}`}
                            loading="lazy"
                          />
                        )}
                        <div className="mt-1 flex items-center gap-1">
                          <p
                            className={`text-lg font-bold ${
                              isLive && Number(home?.score) > Number(away?.score) ? "text-green-600" : ""
                            }`}
                          >
                            {scoreFor(home)}
                          </p>
                          {isLive && teamHasPoss(home) && <span className="text-xs">🏈</span>}
                        </div>
                        {pickedHome && (
                          <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                            Your Pick
                          </span>
                        )}
                      </div>
                    </div>

                    {/* BOTTOM:
                        - Live: left clock/quarter, CENTER red-zone pill (if any), right down&distance
                        - Upcoming: kickoff msg + odds
                        - Final: nothing */}
                    {isLive ? (
                      <div className="mt-2 grid grid-cols-2 items-center text-sm text-zinc-600 dark:text-zinc-400">
                        {/* Left: clock & quarter */}
                        <div className="flex items-center gap-2">
                          <span className="font-medium">
                            {(status?.displayClock || "--:--")} • Q{status?.period ?? "-"}
                          </span>
                        </div>

                        {/* Right: down & distance */}
                        <div className="flex justify-end font-medium">
                          <span>
                            {downText}
                            {spotText ? ` @ ${spotText}` : ""}
                          </span>
                        </div>
                      </div>
                    ) : !isPost ? (
                      <div className="flex justify-between text-sm text-zinc-600 dark:text-zinc-400 mt-2">
                        <div className="italic">Kickoff not started</div>
                        {odds && <p>{odds}{overUnder ? ` | O/U: ${overUnder}` : ""}</p>}
                      </div>
                    ) : null}
                  </motion.div>
                );
              })}
            </div>
          </LazyMotion>
        )}
      </div>

      {selectedGame && (
        <GameDetailModal
          eventId={selectedGame.eventId}
          awayTeam={selectedGame.awayTeam}
          homeTeam={selectedGame.homeTeam}
          isLive={selectedGame.isLive}
          period={selectedGame.period}
          clock={selectedGame.clock}
          possessionTeamId={selectedGame.possessionTeamId}
          downDistanceText={selectedGame.downDistanceText}
          yardLineText={selectedGame.yardLineText}
          isRedZone={selectedGame.isRedZone}
          broadcast={selectedGame.broadcast}
          onClose={() => setSelectedGame(null)}
        />
      )}
    </div>
  );
}
