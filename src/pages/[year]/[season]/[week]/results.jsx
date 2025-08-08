import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { db } from "../../../../lib/firebase";
import { collection, getDocs } from "firebase/firestore";
import Image from "next/image";
import Head from "next/head";

const TYPE_MAP = { pre: 1, reg: 2, post: 3 };

export default function ScoresPage() {
  const router = useRouter();
  const { year, week, season } = router.query;

  const [loading, setLoading] = useState(true);
  const [submissions, setSubmissions] = useState([]);
  const [eventMap, setEventMap] = useState({});
  const [winners, setWinners] = useState({});

  // include season to match how picks are stored; keep legacy fallback for older weeks
  const keyNew = `${year}-${season}-W${week}`;
  const keyLegacy = `${year}-W${week}`;

  useEffect(() => {
    if (!year || !week || !season) return;

    const fetchData = async () => {
      setLoading(true);

      // ---- Read picks from Firestore
      const snapshot = await getDocs(collection(db, "picks"));
      const picks = [];

      for (const docSnap of snapshot.docs) {
        const data = docSnap.data();
        const userData = data[keyNew] || data[keyLegacy];
        if (userData) {
          const entries = Object.entries(userData)
            .filter(([k]) => !["tieBreaker", "displayName", "locked", "submittedAt"].includes(k))
            .map(([eventID, team]) => ({ eventID, teamName: team }));

          picks.push({
            uid: docSnap.id,
            displayName: userData.displayName || "Unknown",
            picks: entries,
            tieBreaker: userData.tieBreaker || "",
          });
        }
      }

      // ---- ESPN feed for this season type
      const seasontype = TYPE_MAP[season] ?? 2;
      const apiUrl = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=${seasontype}&week=${week}&year=${year}`;
      const res = await fetch(apiUrl);
      const data = await res.json();

      const tempMap = {};
      const winnerMap = {};

      (data?.events || []).forEach((event) => {
        const comp = event?.competitions?.[0];
        const comps = comp?.competitors || [];

        const home = comps.find((c) => c.homeAway === "home")?.team;
        const away = comps.find((c) => c.homeAway === "away")?.team;

        tempMap[event.id] = {
          shortName: event.shortName,
          date: event.date,
          home,
          away,
          status: comp?.status?.type?.state, // "pre" | "in" | "post"
        };

        if (comp?.status?.type?.state === "post") {
          const w = comps.find((c) => c.winner);
          if (w) winnerMap[event.id] = w.team.shortDisplayName;
        }
      });

      // ---- Enrich + rank
      const enriched = picks.map((entry) => {
        const winnerCount = entry.picks.filter(
          (p) => winnerMap[p.eventID] === p.teamName
        ).length;
        const gamesRemaining = entry.picks.filter(
          (p) => tempMap[p.eventID]?.status !== "post"
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
  }, [year, week, season]);

  if (loading) return <div className="p-6 text-center">Loading...</div>;

  const uniqueEventIDs = Object.keys(eventMap).sort(
    (a, b) => new Date(eventMap[a].date) - new Date(eventMap[b].date)
  );

  const borderClass = "border border-gray-300";

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 text-gray-900 dark:text-white px-2 py-4 sm:px-4 sm:py-8">
      <Head>
        <title>
          {season ? season.toUpperCase() : "REG"} • Week {week} Scores
        </title>
      </Head>

      <div className="max-w-full overflow-x-auto pb-28">
        <table className={`min-w-full text-sm border-collapse ${borderClass} table-auto`}>
          <thead className="bg-slate-800 text-white shadow-sm">
            <tr>
              <th className={`px-2 py-0.5 text-center font-bold w-[40px] ${borderClass}`}>Rank</th>
              <th
                className={`px-2 py-0.5 sticky left-0 z-10 bg-slate-800 font-bold text-left ${borderClass}`}
              >
                User
              </th>
              <th className={`px-2 py-0.5 text-center font-bold ${borderClass}`}>Total Wins</th>
              <th className={`px-2 py-0.5 text-center font-bold ${borderClass}`}>Games Remaining</th>
              {uniqueEventIDs.map((id) => (
                <th
                  key={id}
                  className={`px-2 py-0.5 text-center font-bold whitespace-nowrap w-24 ${borderClass}`}
                >
                  {eventMap[id].shortName}
                </th>
              ))}
              <th className={`px-2 py-0.5 text-center font-bold bg-slate-800 ${borderClass}`}>TB</th>
              <th className={`px-2 py-0.5 text-center font-bold ${borderClass}`}>Win Probability</th>
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
                  <td className={`px-2 py-0.5 text-center font-bold w-[40px] ${borderClass}`}>
                    {entry.rank}
                  </td>
                  <td
                    className={`px-2 py-0.5 sticky left-0 z-10 font-bold ${rowBg} ${borderClass}`}
                  >
                    {entry.displayName}
                  </td>
                  <td className={`px-2 py-0.5 text-center ${borderClass}`}>{entry.winnerCount}</td>
                  <td className={`px-2 py-0.5 text-center ${borderClass}`}>{entry.gamesRemaining}</td>

                  {uniqueEventIDs.map((eventID) => {
                    const pick = entry.picks.find((p) => p.eventID === eventID);
                    const correct = winners[eventID] === pick?.teamName;
                    const game = eventMap[eventID];
                    const team =
                      game?.home?.shortDisplayName === pick?.teamName ? game.home : game?.away;
                    const isPending = game?.status !== "post";

                    const bgColor = isPending ? "" : correct ? "bg-green-200" : "bg-red-200";

                    return (
                      <td
                        key={eventID}
                        className={`text-center px-2 py-0.5 ${borderClass} ${bgColor} w-24`}
                      >
                        {pick && team?.logo ? (
                          <Image
                            src={team.logo}
                            alt={team?.shortDisplayName || "Team"}
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

                  <td className={`px-2 py-0.5 text-center bg-white dark:bg-gray-950 ${borderClass}`}>
                    <span className="text-xs text-gray-600 dark:text-gray-300">
                      {entry.tieBreaker || "—"}
                    </span>
                  </td>

                  <td className={`px-2 py-0.5 text-center text-gray-500 text-sm ${borderClass}`}>
                    —
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
