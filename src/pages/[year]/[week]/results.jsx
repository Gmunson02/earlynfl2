import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { db } from "../../../lib/firebase";
import { collection, getDocs } from "firebase/firestore";
import Image from "next/image";
import Head from "next/head";
import { Eye, EyeOff } from "lucide-react";

export default function ScoresPage() {
  const router = useRouter();
  const { year, week } = router.query;
  const [loading, setLoading] = useState(true);
  const [submissions, setSubmissions] = useState([]);
  const [eventMap, setEventMap] = useState({});
  const [winners, setWinners] = useState({});
  const [showDetails, setShowDetails] = useState(false);

  const todayKey = `${year}-W${week}`;

  useEffect(() => {
    if (!year || !week) return;

    const fetchData = async () => {
      setLoading(true);

      const snapshot = await getDocs(collection(db, "picks"));
      const picks = [];

      for (const docSnap of snapshot.docs) {
        const data = docSnap.data();
        const userData = data[todayKey];
        if (userData) {
          picks.push({
            uid: docSnap.id,
            displayName: userData.displayName || "Unknown",
            picks: Object.entries(userData)
              .filter(([k]) => k !== "tieBreaker" && k !== "displayName")
              .map(([eventID, team]) => ({ eventID, teamName: team })),
            tieBreaker: userData.tieBreaker || "",
          });
        }
      }

      const apiUrl = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${week}&year=${year}`;
      const res = await fetch(apiUrl);
      const data = await res.json();

      const tempMap = {};
      const winnerMap = {};

      data.events.forEach((event) => {
        const home = event.competitions[0].competitors[0].team;
        const away = event.competitions[0].competitors[1].team;

        tempMap[event.id] = {
          shortName: event.shortName,
          date: event.date,
          home,
          away,
          status: event.status.type.state,
        };

        const competition = event.competitions[0];
        if (competition.status.type.state === "post") {
          const winner = competition.competitors.find((c) => c.winner);
          if (winner) winnerMap[event.id] = winner.team.shortDisplayName;
        }
      });

      const enriched = picks.map((entry) => {
        const winnerCount = entry.picks.filter(
          (pick) => winnerMap[pick.eventID] === pick.teamName
        ).length;
        const gamesRemaining = entry.picks.filter(
          (pick) => tempMap[pick.eventID]?.status !== "post"
        ).length;
        return { ...entry, winnerCount, gamesRemaining };
      });

      enriched.sort((a, b) => b.winnerCount - a.winnerCount);
      let lastWins = null;
      let rank = 0;
      let skip = 1;

      const ranked = enriched.map((entry) => {
        if (entry.winnerCount !== lastWins) {
          rank += skip;
          skip = 1;
        } else {
          skip++;
        }
        lastWins = entry.winnerCount;
        return { ...entry, rank };
      });

      setSubmissions(ranked);
      setEventMap(tempMap);
      setWinners(winnerMap);
      setLoading(false);
    };

    fetchData();
  }, [year, week]);

  if (loading) return <div className="p-6 text-center">Loading...</div>;

  const uniqueEventIDs = Object.keys(eventMap).sort(
    (a, b) => new Date(eventMap[a].date) - new Date(eventMap[b].date)
  );

  const borderClass = showDetails ? "border-none" : "border border-gray-300";

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 text-gray-900 dark:text-white px-2 py-4 sm:px-4 sm:py-8">
      <Head>
        <title>Week {week} Scores</title>
      </Head>

      <div className="mb-4 text-center">
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded transition"
        >
          {showDetails ? <EyeOff size={18} /> : <Eye size={18} />}
          <span>{showDetails ? "Hide Picks" : "Show Picks"}</span>
        </button>
      </div>

      <div className="max-w-full overflow-x-auto pb-28">
        <table className={`min-w-full text-sm border-collapse ${showDetails ? "" : "border border-gray-300"} table-auto`}>
          <thead className="bg-slate-800 text-white shadow-sm">
            <tr>
              {!showDetails && (
                <th className={`px-2 py-0.5 text-center font-bold w-[40px] ${borderClass}`}>
                  Rank
                </th>
              )}
              <th
                className={`px-2 py-0.5 sticky left-0 z-10 bg-slate-800 font-bold ${
                  showDetails ? "text-center min-w-[12rem]" : "text-left"
                } ${borderClass}`}
              >
                User
              </th>
              {!showDetails && (
                <th className={`px-2 py-0.5 text-center font-bold ${borderClass}`}>
                  Total Wins
                </th>
              )}
              {!showDetails && (
                <th className={`px-2 py-0.5 text-center font-bold ${borderClass}`}>
                  Games Remaining
                </th>
              )}
              {showDetails &&
                uniqueEventIDs.map((id) => (
                  <th
                    key={id}
                    className={`px-2 py-0.5 text-center font-bold whitespace-nowrap w-24 ${borderClass}`}
                  >
                    {eventMap[id].shortName}
                  </th>
                ))}
              {showDetails && (
                <th className={`px-2 py-0.5 text-center font-bold bg-slate-800 ${borderClass}`}>
                  TB
                </th>
              )}
              {!showDetails && (
                <th className={`px-2 py-0.5 text-center font-bold ${borderClass}`}>
                  Win Probability
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {submissions.map((entry, index) => {
              const rowBg =
                index % 2 === 0
                  ? "bg-white dark:bg-zinc-900"
                  : "bg-gray-50 dark:bg-zinc-800";

              return (
                <tr key={entry.uid} className={rowBg}>
                  {!showDetails && (
                    <td className={`px-2 py-0.5 text-center font-bold w-[40px] ${borderClass}`}>
                      {entry.rank}
                    </td>
                  )}
                  <td
                    className={`px-2 py-0.5 sticky left-0 z-10 font-bold ${rowBg} ${
                      showDetails ? "min-w-[12rem]" : ""
                    } ${borderClass}`}
                  >
                    {showDetails ? (
                      <>
                        {entry.displayName}{" "}
                        <span className="text-gray-500 font-normal">
                          ({entry.winnerCount} wins)
                        </span>
                      </>
                    ) : (
                      entry.displayName
                    )}
                  </td>
                  {!showDetails && (
                    <td className={`px-2 py-0.5 text-center ${borderClass}`}>
                      {entry.winnerCount}
                    </td>
                  )}
                  {!showDetails && (
                    <td className={`px-2 py-0.5 text-center ${borderClass}`}>
                      {entry.gamesRemaining}
                    </td>
                  )}
                  {showDetails &&
                    uniqueEventIDs.map((eventID) => {
                      const pick = entry.picks.find(
                        (p) => p.eventID === eventID
                      );
                      const correct = winners[eventID] === pick?.teamName;
                      const game = eventMap[eventID];
                      const team =
                        game?.home.shortDisplayName === pick?.teamName
                          ? game.home
                          : game.away;
                      const isPending = game.status !== "post";

                      const bgColor = isPending
                        ? "bg-yellow-100"
                        : correct
                        ? "bg-green-200"
                        : "bg-red-200";

                      return (
                        <td
                          key={eventID}
                          className={`text-center px-2 py-0.5 ${borderClass} ${bgColor} w-24`}
                        >
                          {pick ? (
                            <Image
                              src={team.logo}
                              alt={team.shortDisplayName}
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
                  {showDetails && (
                    <td className={`px-2 py-0.5 text-center bg-white dark:bg-gray-950 ${borderClass}`}>
                      <span className="text-xs text-gray-600 dark:text-gray-300">
                        {entry.tieBreaker || "—"}
                      </span>
                    </td>
                  )}
                  {!showDetails && (
                    <td className={`px-2 py-0.5 text-center text-gray-500 text-sm ${borderClass}`}>
                      —
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
