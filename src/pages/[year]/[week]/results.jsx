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

      // 1. Get all user picks for this week
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

      // 2. Fetch ESPN API data
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
    <div className="max-w-6xl mx-auto px-4 py-6">
      <Head>
        <title>Week {week} Scores</title>
      </Head>
      <h1 className="text-2xl font-bold text-center mb-6">
        Week {week}, {year} Leaderboard
      </h1>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm border table-fixed">
          <thead className="bg-gray-200">
            <tr>
              <th className="text-left p-2 border w-36">User</th>
              <th className="text-center border w-12">Wins</th>
              {uniqueEventIDs.map((id) => (
                <th key={id} className="text-center border w-24">
                  {eventMap[id].shortName}
                </th>
              ))}
              <th className="text-center border w-16">TB</th>
            </tr>
          </thead>
          <tbody>
            {submissions.map((entry) => (
              <tr key={entry.uid} className="border-t">
                <td className="p-2 font-medium border text-left bg-gray-50">
                  {entry.displayName}
                </td>
                <td className="text-center border bg-gray-50">{entry.winnerCount}</td>
                {uniqueEventIDs.map((eventID) => {
                  const pick = entry.picks.find((p) => p.eventID === eventID);
                  const correct = winners[eventID] === pick?.teamName;
                  const game = eventMap[eventID];
                  const team =
                    game?.home.shortDisplayName === pick?.teamName
                      ? game.home
                      : game.away;

                  return (
                    <td key={eventID} className="text-center border w-24">
                      {pick ? (
                        <div
                          className={`flex items-center justify-center p-1 rounded-md ${
                            correct ? "bg-green-100" : "bg-red-100"
                          }`}
                        >
                          <Image
                            src={team.logo}
                            alt={team.shortDisplayName}
                            width={30}
                            height={30}
                          />
                        </div>
                      ) : (
                        "-"
                      )}
                    </td>
                  );
                })}
                <td className="text-center border bg-gray-50">{entry.tieBreaker}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
