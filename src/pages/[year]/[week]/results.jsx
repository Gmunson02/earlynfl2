import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { db } from "../../../lib/firebase";
import { collection, getDocs } from "firebase/firestore";
import Image from "next/image";
import Head from "next/head";

export default function ScoresPage() {
  const router = useRouter();
  const { year, week } = router.query;
  const [loading, setLoading] = useState(true);
  const [submissions, setSubmissions] = useState([]);
  const [eventMap, setEventMap] = useState({});
  const [winners, setWinners] = useState({});

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
        return { ...entry, winnerCount };
      });

      setSubmissions(enriched.sort((a, b) => b.winnerCount - a.winnerCount));
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

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 text-gray-900 dark:text-white px-2 py-4 sm:px-4 sm:py-8">
      <Head>
        <title>Week {week} Scores</title>
      </Head>
      <div className="max-w-full overflow-x-auto pb-28">
        <table className="min-w-full text-sm border-collapse border border-gray-300 dark:border-zinc-700">
          <thead className="bg-slate-800 text-white uppercase tracking-wide text-sm font-semibold shadow-sm">
            <tr>
              <th className="p-3 border border-gray-300 text-left sticky left-0 z-10 bg-slate-800 rounded-tl-md">
                User
              </th>
              <th className="p-3 border border-gray-300 text-center">
                Wins
              </th>
              {uniqueEventIDs.map((id) => (
                <th
                  key={id}
                  className="p-3 border border-gray-300 text-center whitespace-nowrap"
                >
                  {eventMap[id].shortName}
                </th>
              ))}
              <th className="p-3 border border-gray-300 text-center bg-slate-800 rounded-tr-md">
                TB
              </th>
            </tr>
          </thead>
          <tbody>
            {submissions.map((entry) => (
              <tr
                key={entry.uid}
                className="odd:bg-green-50 even:bg-white dark:odd:bg-zinc-800 dark:even:bg-zinc-900"
              >
                <td className="p-2 border sticky left-0 bg-white dark:bg-gray-950 font-semibold z-10">
                  {entry.displayName}
                </td>
                <td className="p-2 border text-center bg-white dark:bg-gray-950 font-bold">
                  {entry.winnerCount}
                </td>
                {uniqueEventIDs.map((eventID) => {
                  const pick = entry.picks.find((p) => p.eventID === eventID);
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
                      className={`text-center p-1 border ${bgColor}`}
                    >
                      {pick ? (
                        <Image
                          src={team.logo}
                          alt={team.shortDisplayName}
                          width={60}
                          height={60}
                          className="mx-auto"
                        />
                      ) : (
                        <span className="text-gray-400">–</span>
                      )}
                    </td>
                  );
                })}
                <td className="p-2 border text-center bg-white dark:bg-gray-950">
                  <span className="text-xs text-gray-600 dark:text-gray-300">
                    {entry.tieBreaker || "—"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
