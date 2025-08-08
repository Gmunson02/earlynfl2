import { useRouter } from "next/router";
import Head from "next/head";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Calendar } from "lucide-react";

export default function GameCenter() {
  const router = useRouter();
  const { year, week } = router.query;
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!year || !week) return;

    const fetchGames = async () => {
      setLoading(true);
      try {
        const res = await fetch("https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard");
        const data = await res.json();
        const sorted = [...(data.events || [])].sort((a, b) => {
          const aStatus = a.competitions?.[0]?.status?.type?.completed;
          const bStatus = b.competitions?.[0]?.status?.type?.completed;
          return aStatus - bStatus;
        });
        setGames(sorted);
      } catch (err) {
        console.error("Failed to load games", err);
      } finally {
        setLoading(false);
      }
    };

    fetchGames();
  }, [year, week]);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-gradient-to-tr dark:from-gray-950 dark:to-gray-900 text-zinc-900 dark:text-white px-6 py-4 pb-32">
      <Head>
        <title>Game Center | Early NFL</title>
      </Head>

      <div className="max-w-5xl mx-auto">
        <header className="mb-6">
          <h1 className="text-3xl font-extrabold flex items-center gap-2">
            <Calendar size={28} /> Game Center – Week {week}
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Live matchups, times, odds & more</p>
        </header>

        {loading ? (
          <p className="text-center text-zinc-500">Loading games...</p>
        ) : games.length === 0 ? (
          <p className="text-center text-zinc-500">No games found.</p>
        ) : (
          <div className="grid gap-4">
            {games.map((event) => {
              const competition = event.competitions?.[0];
              const status = competition?.status?.type?.description || "";
              const detail = competition?.status?.type?.detail || "";
              const gameTime = new Date(event.date).toLocaleString("en-US", {
                weekday: "short",
                hour: "numeric",
                minute: "2-digit",
                hour12: true
              });
              const odds = competition?.odds?.[0]?.details;
              const overUnder = competition?.odds?.[0]?.overUnder;
              const broadcast = competition?.broadcasts?.[0]?.names?.[0];

              const home = competition?.competitors?.find(t => t.homeAway === "home");
              const away = competition?.competitors?.find(t => t.homeAway === "away");

              const getScore = (team) => {
                if (competition?.status?.type?.state === "in") {
                  return team?.score;
                } else if (competition?.status?.type?.completed) {
                  return team?.score;
                } else {
                  return "--";
                }
              };

              const teamLogo = (team) => (
                <div className="flex items-center justify-center">
                  {team?.team?.logo && (
                    <img src={team.team.logo} alt="logo" className="w-10 h-10 rounded-full" />
                  )}
                </div>
              );

              const liveDetail = competition?.status?.type?.state === "in"
                ? <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">{detail}</p>
                : <p className="text-sm italic text-zinc-400">Kickoff not started</p>;

              return (
                <motion.div
                  key={event.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-white dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 rounded-xl shadow p-4"
                >
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{status}</p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        {gameTime} {broadcast && `• ${broadcast}`}
                      </p>
                    </div>
                  </div>

                  <div className="flex justify-between items-center mb-2">
                    <div className="flex flex-col items-center">
                      {teamLogo(away)}
                      <p className="text-lg font-bold mt-1">{getScore(away)}</p>
                    </div>
                    <span className="text-lg font-bold text-zinc-500">@</span>
                    <div className="flex flex-col items-center">
                      {teamLogo(home)}
                      <p className="text-lg font-bold mt-1">{getScore(home)}</p>
                    </div>
                  </div>

                  <div className="flex justify-between text-sm text-zinc-600 dark:text-zinc-400 mt-2">
                    <div className="text-sm text-zinc-600 dark:text-zinc-400 italic">
                      {liveDetail}
                    </div>
                    {odds && <p>{odds} | O/U: {overUnder}</p>}
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
