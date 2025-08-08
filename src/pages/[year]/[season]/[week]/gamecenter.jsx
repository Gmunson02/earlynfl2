import { useRouter } from "next/router";
import Head from "next/head";
import { useEffect, useMemo, useState } from "react";
import { LazyMotion, domAnimation, m as motion } from "framer-motion";
import { Calendar } from "lucide-react";
import Image from "next/image";

const TYPE_MAP = { pre: 1, reg: 2, post: 3 };

export default function GameCenter() {
  const router = useRouter();
  const { year, week, season: seasonRaw } = router.query;

  // normalize season from query (default to "reg")
  const season = useMemo(() => {
    const s = Array.isArray(seasonRaw) ? seasonRaw[0] : seasonRaw;
    const v = String(s || "").toLowerCase();
    return v === "pre" || v === "reg" || v === "post" ? v : "reg";
  }, [seasonRaw]);

  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);

  // Reuse a single formatter instance
  const timeFmt = useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", {
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }),
    []
  );

  useEffect(() => {
    if (!router.isReady || !year || !week) return;

    const controller = new AbortController();
    const { signal } = controller;

    const fetchGames = async () => {
      setLoading(true);
      try {
        const stype = TYPE_MAP[season]; // 1/2/3
        const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?year=${year}&week=${week}&seasontype=${stype}`;
        const res = await fetch(url, { signal, cache: "no-store" });
        const data = await res.json();
        const events = Array.isArray(data?.events) ? data.events : [];

        const stateRank = (evt) => {
          const st = evt?.competitions?.[0]?.status?.type?.state;
          if (st === "pre") return 0;
          if (st === "in") return 1;
          if (st === "post") return 2;
          return 3;
        };

        const sorted = events.slice().sort((a, b) => {
          const sa = stateRank(a);
          const sb = stateRank(b);
          if (sa !== sb) return sa - sb;
          return new Date(a.date) - new Date(b.date);
        });

        setGames(sorted);
      } catch (err) {
        if (err.name !== "AbortError") {
          console.error("Failed to load games", err);
        }
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    };

    fetchGames();
    return () => controller.abort();
  }, [router.isReady, year, week, season]);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-gradient-to-tr dark:from-gray-950 dark:to-gray-900 text-zinc-900 dark:text-white px-6 py-4 pb-32">
      <Head>
        <title>Game Center | {String(year)} {season.toUpperCase()} • Week {String(week)}</title>
      </Head>

      <div className="max-w-5xl mx-auto">
        <header className="mb-6">
          <h1 className="text-3xl font-extrabold flex items-center gap-2">
            <Calendar size={28} /> Game Center — {String(year)} {season.toUpperCase()} • Week {String(week)}
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Live matchups, times, odds & more</p>
        </header>

        {loading ? (
          <p className="text-center text-zinc-500">Loading games...</p>
        ) : games.length === 0 ? (
          <p className="text-center text-zinc-500">No games found.</p>
        ) : (
          <LazyMotion features={domAnimation}>
            <div className="grid gap-4">
              {games.map((event) => {
                const comp = event?.competitions?.[0];
                const t = comp?.status?.type || {};
                const isIn = t?.state === "in";
                const isPost = t?.state === "post" || t?.completed;

                const statusText = t?.shortDetail || t?.description || "";
                const detailText = t?.detail || "";

                const odds = comp?.odds?.[0]?.details;
                const overUnder = comp?.odds?.[0]?.overUnder;
                const broadcast = comp?.broadcasts?.[0]?.names?.[0];

                const home = comp?.competitors?.find((x) => x.homeAway === "home");
                const away = comp?.competitors?.find((x) => x.homeAway === "away");

                const scoreFor = (team) => (isIn || isPost ? team?.score : "--");

                const liveDetail = isIn ? (
                  <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">{detailText || statusText}</p>
                ) : isPost ? (
                  <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                    {detailText || statusText || "Final"}
                  </p>
                ) : (
                  <p className="text-sm italic text-zinc-400">Kickoff not started</p>
                );

                return (
                  <motion.div
                    key={event.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-white dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 rounded-xl shadow p-4"
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{statusText}</p>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                          {timeFmt.format(new Date(event.date))} {broadcast && `• ${broadcast}`}
                        </p>
                      </div>
                    </div>

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
                        <p className="text-lg font-bold mt-1">{scoreFor(away)}</p>
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
                        <p className="text-lg font-bold mt-1">{scoreFor(home)}</p>
                      </div>
                    </div>

                    <div className="flex justify-between text-sm text-zinc-600 dark:text-zinc-400 mt-2">
                      <div className="italic">{liveDetail}</div>
                      {odds && <p>{odds}{overUnder ? ` | O/U: ${overUnder}` : ""}</p>}
                    </div>
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
