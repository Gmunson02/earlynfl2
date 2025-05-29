import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { auth, db } from "../../../lib/firebase";
import {
  onAuthStateChanged
} from "firebase/auth";
import {
  doc,
  getDoc,
  setDoc,
  collection
} from "firebase/firestore";
import Image from "next/image";

// Server-side fetch of matchups from ESPN API
export async function getServerSideProps(context) {
  const { year, week } = context.query;
  const apiUrl = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${week}&year=${year}`;

  const res = await fetch(apiUrl);
  const data = await res.json();

  const matchups = data.events.map((event) => {
    const comp = event.competitions[0];
    const [homeComp, awayComp] = comp.competitors;

    return {
      eventId: event.id,
      gameDate: event.date,
      spread: comp.odds?.[0]?.details || "No Spread Available",
      overUnder: comp.odds?.[0]?.overUnder || "No O/U Available",
      homeTeam: {
        name: homeComp.team.shortDisplayName,
        logo: homeComp.team.logo,
        id: homeComp.team.id,
        record: homeComp.records?.[0]?.summary || "0-0",
        isHome: true,
      },
      awayTeam: {
        name: awayComp.team.shortDisplayName,
        logo: awayComp.team.logo,
        id: awayComp.team.id,
        record: awayComp.records?.[0]?.summary || "0-0",
        isHome: false,
      },
    };
  });

  return {
    props: {
      year,
      week,
      matchups,
    },
  };
}

export default function PicksPage({ year, week, matchups }) {
  const [user, setUser] = useState(null);
  const [picks, setPicks] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [tieBreaker, setTieBreaker] = useState("");
  const todayKey = `${year}-W${week}`;
  const lastGame = matchups[matchups.length - 1];

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setUser(user);
      if (user) {
        const docRef = doc(db, "picks", user.uid);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists() && docSnap.data()[todayKey]) {
          setPicks(docSnap.data()[todayKey]);
          setTieBreaker(docSnap.data()[todayKey].tieBreaker || "");
          setSubmitted(true);
        }
      }
    });
    return () => unsubscribe();
  }, [todayKey]);

  const handlePick = (eventId, teamName) => {
    if (submitted) return;
    setPicks((prev) => ({ ...prev, [eventId]: teamName }));
  };

  const handleSubmit = async () => {
    if (!user || submitted) return;
    try {
      const ref = doc(collection(db, "picks"), user.uid);
      await setDoc(ref, { [todayKey]: { ...picks, tieBreaker } }, { merge: true });
      setSubmitted(true);
      alert("Picks submitted!");
    } catch (err) {
      console.error("Submission failed", err);
    }
  };

  const isSubmitDisabled =
    submitted ||
    Object.keys(picks).length !== matchups.length ||
    tieBreaker.trim() === "";

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <h1 className="text-3xl font-bold text-center mb-6">Week {week} Picks</h1>

      <div className="flex justify-center mb-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showDetails}
            onChange={() => setShowDetails(!showDetails)}
            className="accent-blue-600"
          />
          <span className="text-blue-700 font-medium">Display Game Details</span>
        </label>
      </div>

      <div className="space-y-6">
        {matchups.map((game) => {
          const isPicked = picks[game.eventId];
          return (
            <div
              key={game.eventId}
              className="rounded-xl border border-gray-200 shadow-sm p-3 bg-white"
            >
              <div className="text-sm font-semibold text-center text-blue-600 mb-2">
                {new Date(game.gameDate).toLocaleString("en-US", {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "numeric",
                })}
              </div>

              {showDetails && (
                <div className="text-center text-xs text-gray-600 mb-2">
                  <div>Spread: {game.spread}</div>
                  <div>O/U: {game.overUnder}</div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                {[game.awayTeam, game.homeTeam].map((team) => {
                  const selected = picks[game.eventId] === team.name;
                  return (
                    <button
                      key={team.id}
                      onClick={() => handlePick(game.eventId, team.name)}
                      className={`flex flex-col items-center justify-center px-2 py-2 rounded-lg border transition text-center ${
                        selected
                          ? "border-blue-500 bg-blue-50 ring-2 ring-blue-400"
                          : "border-gray-300 hover:bg-gray-50"
                      }`}
                    >
                      <Image
                        src={team.logo}
                        alt={team.name}
                        width={32}
                        height={32}
                        className="rounded"
                      />
                      <div className="text-sm font-bold uppercase mt-1">{team.name}</div>
                      <div className="text-xs text-gray-500">{team.record}</div>
                      <div className="text-xs text-gray-400 italic">{team.isHome ? "Home" : "Away"}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Tie Breaker Input */}
      <div className="mt-10 max-w-md mx-auto">
        <label htmlFor="tieBreaker" className="block text-center font-medium text-gray-700 mb-2">
          Tie Breaker — Total Points in {lastGame.awayTeam.name} @ {lastGame.homeTeam.name}
        </label>
        <input
          type="number"
          id="tieBreaker"
          value={tieBreaker}
          onChange={(e) => setTieBreaker(e.target.value)}
          className="w-full p-3 border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Enter total combined score"
        />
      </div>

      <div className="mt-10 text-center">
        <button
          onClick={handleSubmit}
          disabled={isSubmitDisabled}
          className={`px-6 py-3 font-semibold text-white rounded-lg transition ${
            isSubmitDisabled ? "bg-gray-400 cursor-not-allowed" : "bg-green-600 hover:bg-green-700"
          }`}
        >
          {submitted ? "Picks Submitted" : "Submit Picks"}
        </button>
      </div>
    </div>
  );
}
