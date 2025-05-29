import Head from "next/head";

export default function LeaderboardPage() {
  const placeholderData = [
    { rank: 1, name: "Alex", totalWins: 4, totalPoints: 52 },
    { rank: 2, name: "Jamie", totalWins: 3, totalPoints: 49 },
    { rank: 3, name: "Casey", totalWins: 2, totalPoints: 45 },
    { rank: 4, name: "Riley", totalWins: 1, totalPoints: 39 },
    { rank: 5, name: "Taylor", totalWins: 0, totalPoints: 37 },
  ];

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <Head>
        <title>Leaderboard</title>
      </Head>
      <h1 className="text-3xl font-bold text-center mb-6 text-gray-900 dark:text-gray-100">
        Season Leaderboard
      </h1>
      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700 shadow">
        <table className="min-w-full text-sm text-left text-gray-700 dark:text-gray-200">
          <thead className="bg-gray-100 dark:bg-gray-800 text-xs uppercase">
            <tr>
              <th className="px-4 py-3">Rank</th>
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Total Wins</th>
              <th className="px-4 py-3">Total Points</th>
            </tr>
          </thead>
          <tbody>
            {placeholderData.map((entry) => (
              <tr
                key={entry.rank}
                className="border-t border-gray-200 dark:border-gray-700"
              >
                <td className="px-4 py-2 font-semibold">{entry.rank}</td>
                <td className="px-4 py-2">{entry.name}</td>
                <td className="px-4 py-2">{entry.totalWins}</td>
                <td className="px-4 py-2">{entry.totalPoints}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
} 
