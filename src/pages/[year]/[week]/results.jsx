import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { db } from "../../../lib/firebase";
import {
  collection,
  getDocs
} from "firebase/firestore";

export default function ResultsPage() {
  const router = useRouter();
  const { year, week } = router.query;
  const [allPicks, setAllPicks] = useState([]);
  const [loading, setLoading] = useState(true);
  const todayKey = `${year}-W${week}`;

  useEffect(() => {
    if (!year || !week) return;

    const fetchPicks = async () => {
      setLoading(true);
      const snapshot = await getDocs(collection(db, "picks"));
      const results = [];

      for (const docSnap of snapshot.docs) {
        const userPicks = docSnap.data();
        const userData = userPicks[todayKey];

        if (userData) {
          const displayName = userData.displayName?.trim() || "Unknown";

          results.push({
            uid: docSnap.id,
            displayName,
            picks: userData,
          });
        }
      }

      setAllPicks(results);
      setLoading(false);
    };

    fetchPicks();
  }, [year, week]);

  if (loading) return <div className="p-6 text-center">Loading results...</div>;

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold text-center mb-6">Picks for Week {week}, {year}</h1>
      {allPicks.length === 0 ? (
        <p className="text-center text-gray-600">No picks found for this week.</p>
      ) : (
        <ul className="space-y-4">
          {allPicks.map(({ uid, displayName, picks }) => (
            <li key={uid} className="border rounded-lg p-4 shadow-sm bg-white">
              <h2 className="font-semibold mb-2">{displayName}</h2>
              <ul className="text-sm space-y-1">
                {Object.entries(picks)
                  .filter(([key]) => key !== "tieBreaker" && key !== "displayName")
                  .map(([eventId, teamName]) => (
                    <li key={eventId}>
                      <span className="font-medium">Game {eventId}:</span> {teamName}
                    </li>
                  ))}
              </ul>
              <p className="text-xs mt-2 text-gray-500">
                Tie Breaker: {picks.tieBreaker || "N/A"}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
