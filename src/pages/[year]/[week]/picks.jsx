import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { auth, db } from "../../../lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, setDoc, collection } from "firebase/firestore";
import Image from "next/image";
import { Unlock, Info } from "lucide-react";

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
  const [userProfile, setUserProfile] = useState(null);
  const [picks, setPicks] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [hasUnlocked, setHasUnlocked] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [tieBreaker, setTieBreaker] = useState("");
  const [submittedAt, setSubmittedAt] = useState(null);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const router = useRouter();
  const todayKey = `${year}-W${week}`;
  const lastGame = matchups[matchups.length - 1];

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setUser(user);
      if (user) {
        const docRef = doc(db, "picks", user.uid);
        const docSnap = await getDoc(docRef);

        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
          setUserProfile(userSnap.data());
        }

        if (docSnap.exists() && docSnap.data()[todayKey]) {
          const pickData = docSnap.data()[todayKey];
          setPicks(pickData);
          setTieBreaker(pickData.tieBreaker || "");
          setSubmitted(pickData.locked ?? true);
          setSubmittedAt(pickData.submittedAt || null);
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
    if (!user) return;

    const name = userProfile?.displayName || "";

    try {
      const now = new Date().toISOString();
      const ref = doc(collection(db, "picks"), user.uid);
      await setDoc(
        ref,
        {
          [todayKey]: {
            ...picks,
            tieBreaker,
            displayName: name,
            locked: true,
            submittedAt: now,
          },
        },
        { merge: true }
      );
      setSubmitted(true);
      setSubmittedAt(now);
      setShowConfirmation(true); // 🎉 Modal instead of toast
    } catch (err) {
      console.error("Submission failed", err);
    }
  };

  const toggleLock = () => {
    setSubmitted(false);
    setHasUnlocked(true);
    setPicks((prev) => {
      const updated = { ...prev };
      delete updated.locked;
      delete updated.submittedAt;
      return updated;
    });
  };

  const pickedGames = matchups.filter((game) => picks[game.eventId]);
  const isSubmitDisabled =
    submitted ||
    pickedGames.length !== matchups.length ||
    tieBreaker.trim() === "";

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 pb-32 bg-white dark:bg-gray-900 min-h-screen">
      <h1 className="text-4xl font-extrabold text-center mb-2 text-gray-900 dark:text-white tracking-tight">
        🏈 Week {week} Picks
      </h1>

      {userProfile?.displayName && (
        <div className="mb-4 text-center text-lg text-gray-800 dark:text-gray-200 font-medium">
          Welcome back,&nbsp;
          <span className="font-bold text-gray-900 dark:text-white text-xl">
            {userProfile.displayName}
          </span>{" "}
          👋
        </div>
      )}

      {submittedAt && (
        <div className="mb-4 text-center text-xs text-gray-500 dark:text-gray-400 italic">
          Picks last submitted on {new Date(submittedAt).toLocaleString()}
        </div>
      )}

      {submitted && (
        <div className="flex justify-center mb-4">
          <button
            onClick={toggleLock}
            className={`flex items-center gap-2 px-4 py-2 w-64 justify-center rounded-md text-sm font-medium transition border ${hasUnlocked
                ? "bg-blue-50 dark:bg-blue-900 text-blue-700 dark:text-blue-200 border-blue-400"
                : "bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-100 border-gray-400 hover:bg-gray-300 dark:hover:bg-gray-600"
              }`}
          >
            <Unlock size={16} />
            Unlock Picks
          </button>
        </div>
      )}

      <div className="flex justify-center mb-4">
        <button
          onClick={() => setShowDetails(!showDetails)}
          className={`flex items-center gap-2 px-4 py-2 w-64 justify-center rounded-md text-sm font-medium transition border ${showDetails
              ? "bg-blue-50 dark:bg-blue-900 text-blue-700 dark:text-blue-200 border-blue-400"
              : "bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-100 border-gray-400 hover:bg-gray-300 dark:hover:bg-gray-600"
            }`}
        >
          <Info size={16} />
          {showDetails ? "Hide Game Details" : "Show Game Details"}
        </button>
      </div>

      {hasUnlocked && (
        <div className="text-center text-xs text-orange-500 dark:text-orange-400 italic mb-4">
          Picks are unlocked. You can edit and resubmit.
        </div>
      )}

      <div className="space-y-6">
        {matchups.map((game) => (
          <div
            key={game.eventId}
            className="rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-3 bg-white dark:bg-gray-800"
          >
            <div className="text-sm font-semibold text-center text-blue-600 dark:text-blue-300 mb-2">
              {new Date(game.gameDate).toLocaleString("en-US", {
                weekday: "short",
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "numeric",
              })}
            </div>

            {showDetails && (
              <div className="text-center text-xs text-gray-600 dark:text-gray-400 mb-2">
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
                    className={`flex flex-col items-center justify-center px-2 py-2 rounded-lg border transition text-center ${selected
                        ? "border-blue-500 bg-blue-50 dark:bg-blue-900 ring-2 ring-blue-400"
                        : "border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700"
                      }`}
                    disabled={submitted}
                  >
                    <Image
                      src={team.logo}
                      alt={team.name}
                      width={48}
                      height={48}
                      className="rounded"
                    />
                    <div className="text-sm font-bold uppercase mt-1 text-gray-900 dark:text-white">
                      {team.name}
                    </div>
                    {showDetails && (
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        {team.record} ({team.isHome ? "Home" : "Away"})
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-10 max-w-md mx-auto">
        <label htmlFor="tieBreaker" className="block text-center font-medium text-gray-700 dark:text-gray-200 mb-2">
          <div className="text-lg font-semibold">Tie Breaker</div>
          <div>Total Points in {lastGame.awayTeam.name} @ {lastGame.homeTeam.name}</div>
        </label>
        <input
          type="number"
          id="tieBreaker"
          value={tieBreaker}
          onChange={(e) => setTieBreaker(e.target.value)}
          className="w-full p-3 border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 text-black dark:text-white border-gray-300 dark:border-gray-600 text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          placeholder="Enter total combined score"
          disabled={submitted}
        />
      </div>

      <div className="mt-10 text-center">
        <button
          onClick={handleSubmit}
          disabled={isSubmitDisabled}
          className={`px-6 py-3 font-semibold text-white rounded-lg transition ${isSubmitDisabled ? "bg-gray-400 cursor-not-allowed" : "bg-green-600 hover:bg-green-700"
            }`}
        >
          {submitted ? "Picks Submitted" : "Submit Picks"}
        </button>
      </div>

      {/* 🎉 Confirmation Modal */}
      {showConfirmation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 dark:bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-900 rounded-xl p-6 shadow-xl max-w-sm w-full text-center">
            <div className="text-4xl mb-3">🎉</div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
              Your picks have been submitted!
            </h2>
            <p className="text-gray-600 dark:text-gray-300 mb-5">
              Good luck this week.
            </p>
            <button
              onClick={() => router.push("/dashboard")}
              className="px-5 py-2 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700"
            >
              Go to Dashboard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
