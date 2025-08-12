import { useRouter } from "next/router";
import Head from "next/head";
import { useEffect, useMemo, useRef, useState } from "react";
import { LazyMotion, domAnimation, m as motion } from "framer-motion";
import { RefreshCw } from "lucide-react";
import Image from "next/image";

const TYPE_MAP = { pre: 1, reg: 2, post: 3 };

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

  const lastKeyRef = useRef(""); // for change detection
  const timeoutRef = useRef(null); // adaptive timer

  // Include seconds
  const timeFmt = useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", {
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
      }),
    []
  );

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

                return (
<motion.div
  key={event.id}
  initial={{ opacity: 0, y: 10 }}
  animate={{ opacity: 1, y: 0 }}
  className={`bg-white dark:bg-zinc-800/80 border rounded-xl shadow p-4 ${
    isLive
      ? "border-blue-500 shadow-blue-500/20"
      : "border-zinc-200 dark:border-zinc-700"
  }`}
>
{/* TOP: center LIVE when live, else status/kickoff */}
{isLive ? (
  <div className="flex justify-center mb-2">
<span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-blue-200 text-blue-900">
  LIVE
</span>
  </div>
) : (
  <div className="flex justify-between items-start mb-2">
    <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
      {statusText}
    </p>
    {!isPost && (
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        {timeFmt.format(new Date(event.date))}
        {broadcast ? ` • ${broadcast}` : ""}
      </p>
    )}
  </div>
)}

                    {/* SCORES (🏈 next to team with possession) */}
                    <div className="flex justify-between items-center mb-2">
                      <div className="flex flex-col items-center">
                        {away?.team?.logo && (
                          <Image
                            src={away.team.logo}
                            alt={`${away?.team?.shortDisplayName || "Away"} logo`}
                            width={40}
                            height={40}
                            className="rounded-full"
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
                      </div>

                      <span className="text-lg font-bold text-zinc-500">@</span>

                      <div className="flex flex-col items-center">
                        {home?.team?.logo && (
                          <Image
                            src={home.team.logo}
                            alt={`${home?.team?.shortDisplayName || "Home"} logo`}
                            width={40}
                            height={40}
                            className="rounded-full"
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
                      </div>
                    </div>

                    {/* BOTTOM:
                        - Live: left clock/quarter, CENTER red-zone pill (if any), right down&distance
                        - Upcoming: kickoff msg + odds
                        - Final: nothing */}
                    {isLive ? (
                      <div className="mt-2 grid grid-cols-3 items-center text-sm text-zinc-600 dark:text-zinc-400">
                        {/* Left: clock & quarter */}
                        <div className="flex items-center gap-2">
                          <span className="font-medium">
                            {(status?.displayClock || "--:--")} • Q{status?.period ?? "-"}
                          </span>
                        </div>

{/* Center: RED ZONE indicator (only if in red zone) */}
<div className="flex justify-center">
  {sit.isRedZone && (
    <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-red-300 text-red-900">
      RED ZONE
    </span>
  )}
</div>

                        {/* Right: down & distance */}
                        <div className="flex justify-end font-medium">
                          <span>
                            {(sit.shortDownDistanceText || sit.downDistanceText) ?? ""}
                            {sit.yardLineText ? ` @ ${sit.yardLineText}` : ""}
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
    </div>
  );
}
