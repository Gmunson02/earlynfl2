import { useEffect, useState } from "react";
import { auth, db } from "../lib/firebase";
import { doc, getDoc, collection, getDocs } from "firebase/firestore";
import { useRouter } from "next/router";
import Head from "next/head";
import {
  Calendar,
  ClipboardList,
  Clock,
  Trophy,
  TrendingUp,
  Settings,
  PlayCircle
} from "lucide-react";
import { motion } from "framer-motion";
import { onAuthStateChanged } from "firebase/auth";

export default function Dashboard() {
  const [userName, setUserName] = useState("");
  const [currentWeek, setCurrentWeek] = useState("?");
  const [lastWeekWinner, setLastWeekWinner] = useState(null);
  const [countdown, setCountdown] = useState("");
  const router = useRouter();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        const ref = doc(db, "users", user.uid);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const data = snap.data();
          setUserName(data.displayName || "Anonymous");
        } else {
          setUserName("Anonymous");
        }
      } else {
        setUserName("Guest");
      }
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
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

  const ActionButton = ({ onClick, icon: Icon, label, disabled = false }) => (
    <motion.button
      whileHover={!disabled ? { scale: 1.05 } : {}}
      whileTap={!disabled ? { scale: 0.97 } : {}}
      onClick={onClick}
      disabled={disabled}
      className={`p-4 rounded-xl flex items-center gap-3 justify-start w-full text-left transition-all border border-zinc-200 dark:border-zinc-700 shadow-md backdrop-blur-md ${
        disabled
          ? "bg-zinc-300 text-zinc-500 cursor-not-allowed dark:bg-zinc-600 dark:text-zinc-400"
          : "bg-white hover:bg-zinc-100 text-zinc-800 dark:bg-white/10 dark:hover:bg-white/20 dark:text-white"
      }`}
    >
      <Icon size={20} />
      <span className="font-semibold">{label}</span>
    </motion.button>
  );

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-gradient-to-tr dark:from-gray-950 dark:to-gray-900 text-zinc-900 dark:text-white px-6 py-4 pb-32">
      <Head>
        <title>Dashboard | Early NFL</title>
      </Head>

      <div className="max-w-5xl mx-auto">
        <header className="mb-4">
          <h1 className="text-3xl font-extrabold">
            Hi, {userName}!
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">Ready to make your picks?</p>
        </header>

        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4 mb-6"
        >
          <div className="bg-white dark:bg-zinc-800/80 p-3 sm:p-4 rounded-xl border border-zinc-200 dark:border-zinc-700 shadow text-center">
            <h2 className="text-sm sm:text-base font-semibold mb-1">Current Week</h2>
            <p className="text-base sm:text-xl font-bold text-indigo-600 dark:text-indigo-400">Week {currentWeek}</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 hidden sm:block">NFL 2025 Season</p>
          </div>

          <div className="bg-white dark:bg-zinc-800/80 p-3 sm:p-4 rounded-xl border border-zinc-200 dark:border-zinc-700 shadow text-center">
            <h2 className="text-sm sm:text-base font-semibold mb-1">Next Week Countdown</h2>
            <p className="text-base sm:text-xl font-bold text-amber-600 dark:text-yellow-400">{countdown}</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 hidden sm:block">Until next kickoff</p>
          </div>

          {lastWeekWinner && (
            <div className="bg-white dark:bg-zinc-800/80 p-3 sm:p-4 rounded-xl border border-zinc-200 dark:border-zinc-700 shadow text-center">
              <h2 className="text-sm sm:text-base font-semibold mb-1">Last Week's Winner</h2>
              <p className="text-base sm:text-xl font-bold text-green-600 dark:text-green-400">{lastWeekWinner.displayName}</p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 hidden sm:block">{lastWeekWinner.correct} correct picks</p>
            </div>
          )}
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"
        >
          <ActionButton
            onClick={() => router.push(`/${2025}/${currentWeek}/picks`)}
            icon={ClipboardList}
            label="Manage Your Picks"
          />
          <ActionButton
            onClick={() => router.push(`/${2025}/${currentWeek}/results`)}
            icon={Calendar}
            label="This Week’s Results"
          />
          <ActionButton
            disabled
            icon={Clock}
            label="Last Week’s Results"
          />
          <ActionButton
            onClick={() => router.push(`/${2025}/${currentWeek}/gamecenter`)}
            icon={PlayCircle}
            label="Game Center"
          />
          <ActionButton
            onClick={() => router.push("/leaderboard")}
            icon={TrendingUp}
            label="Leaderboard"
          />
          <ActionButton
            onClick={() => router.push("/profile")}
            icon={Settings}
            label="Settings"
          />
        </motion.section>
      </div>
    </div>
  );
}
