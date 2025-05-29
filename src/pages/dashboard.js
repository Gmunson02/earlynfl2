import { useEffect, useState } from "react";
import { auth, db } from "../lib/firebase";
import { doc, getDoc, collection, getDocs } from "firebase/firestore";
import { useRouter } from "next/router";
import Head from "next/head";
import { Calendar, ClipboardList, Clock, Trophy, UserCircle } from "lucide-react";

export default function Dashboard() {
  const [userName, setUserName] = useState("");
  const [currentWeek, setCurrentWeek] = useState("?");
  const [lastWeekWinner, setLastWeekWinner] = useState(null);
  const [countdown, setCountdown] = useState("");
  const router = useRouter();

  useEffect(() => {
    const fetchUserData = async () => {
      const user = auth.currentUser;
      if (user && !user.isAnonymous) {
        const ref = doc(db, "users", user.uid);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const data = snap.data();
          setUserName(data.displayName || "Anonymous");
        }
      } else {
        setUserName("Guest");
      }
    };

    const calculateCurrentWeek = () => {
      const seasonStart = new Date("2025-09-05T20:20:00");
      const today = new Date();
      const diff = Math.floor((today - seasonStart) / (1000 * 60 * 60 * 24));
      const week = Math.max(1, Math.floor(diff / 7) + 1);
      setCurrentWeek(week);

      const nextKickoff = new Date(seasonStart.getTime() + (week - 1) * 7 * 24 * 60 * 60 * 1000);
      const updateCountdown = () => {
        const now = new Date();
        const timeLeft = nextKickoff - now;

        if (timeLeft > 0) {
          const days = Math.floor(timeLeft / (1000 * 60 * 60 * 24));
          const hours = Math.floor((timeLeft / (1000 * 60 * 60)) % 24);
          const minutes = Math.floor((timeLeft / (1000 * 60)) % 60);
          const seconds = Math.floor((timeLeft / 1000) % 60);
          setCountdown(`${days}d ${hours}h ${minutes}m ${seconds}s`);
        } else {
          setCountdown("Kickoff underway!");
        }
      };

      updateCountdown();
      const interval = setInterval(updateCountdown, 1000);
      return () => clearInterval(interval);
    };

    fetchUserData();
    calculateCurrentWeek();
  }, []);

  useEffect(() => {
    if (currentWeek !== "?") {
      fetchLastWeekWinner(Math.max(1, parseInt(currentWeek) - 1));
    }
  }, [currentWeek]);

  const fetchLastWeekWinner = async (week) => {
    const key = `2025-W${week}`;
    const snap = await getDocs(collection(db, "picks"));
    let winner = null;
    let maxCorrect = -1;

    for (const docSnap of snap.docs) {
      const data = docSnap.data()[key];
      if (!data) continue;
      const { displayName, tieBreaker, ...picks } = data;
      const correct = Object.values(picks).filter((v) => v === "✅").length;
      if (correct > maxCorrect) {
        maxCorrect = correct;
        winner = { displayName, correct };
      }
    }
    setLastWeekWinner(winner);
  };

  return (
    <div className="min-h-screen bg-gradient-to-tr from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 text-gray-900 dark:text-white px-4 py-8">
      <Head>
        <title>Dashboard | Early NFL</title>
      </Head>

      <div className="max-w-3xl mx-auto bg-white dark:bg-gray-900 bg-opacity-80 dark:bg-opacity-80 backdrop-blur-md p-6 rounded-2xl shadow-xl">
        <h1 className="text-4xl font-bold mb-4 text-center text-indigo-700 dark:text-indigo-300">Welcome, {userName}</h1>

        <div className="text-center mb-6">
          <p className="text-2xl font-semibold text-gray-800 dark:text-gray-100">Week {currentWeek}</p>
          <p className="text-lg text-gray-600 dark:text-gray-400">of the 2025 NFL Season</p>
          <p className="mt-2 text-sm font-mono">Kickoff in: <span className="font-semibold">{countdown}</span></p>
        </div>

        {lastWeekWinner && (
          <div className="text-center p-4 rounded-xl mb-6 border border-gray-300 dark:border-gray-700">
            <p className="text-lg font-medium">Last Week's Winner:</p>
            <p className="text-xl font-semibold text-indigo-600 dark:text-indigo-300">{lastWeekWinner.displayName}</p>
            <p className="text-sm">with {lastWeekWinner.correct} correct picks</p>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button
            onClick={() => router.push(`/${2025}/${currentWeek}/picks`)}
            className="p-5 bg-blue-600 text-white rounded-xl shadow-lg hover:scale-105 transform transition flex items-center justify-center gap-3"
          >
            <ClipboardList size={22} /> Make This Week's Picks
          </button>
          <button
            onClick={() => router.push(`/${2025}/${currentWeek}/results`)}
            className="p-5 bg-indigo-600 text-white rounded-xl shadow-lg hover:scale-105 transform transition flex items-center justify-center gap-3"
          >
            <Calendar size={22} /> View This Week's Results
          </button>
          <button
            disabled
            className="p-5 bg-yellow-300 text-white rounded-xl shadow cursor-not-allowed flex items-center justify-center gap-3"
          >
            <Clock size={22} /> View Last Week's Results
          </button>
          <button
            onClick={() => router.push("/leaderboard")}
            className="p-5 bg-purple-600 text-white rounded-xl shadow-lg hover:scale-105 transform transition flex items-center justify-center gap-3"
          >
            <Trophy size={22} /> View Leaderboard
          </button>
          <button
            onClick={() => router.push("/profile")}
            className="p-5 bg-gray-800 text-white rounded-xl shadow-lg hover:scale-105 transform transition flex items-center justify-center gap-3"
          >
            <UserCircle size={22} /> View/Edit Profile
          </button>
        </div>
      </div>
    </div>
  );
}
