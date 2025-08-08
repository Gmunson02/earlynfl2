import { useEffect, useMemo, useCallback, useState } from "react";
import { auth, db } from "../lib/firebase";
import { doc, getDoc, collection, getDocs } from "firebase/firestore";
import { useRouter } from "next/router";
import Head from "next/head";
import { Calendar, ClipboardList, Clock, TrendingUp, Settings, PlayCircle } from "lucide-react";
import { motion } from "framer-motion";
import { onAuthStateChanged } from "firebase/auth";
import React from "react";

// ---- hooks -------------------------------------------------

function useUserName() {
  const [userName, setUserName] = useState("Guest");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) return setUserName("Guest");
      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        setUserName(snap.exists() ? snap.data().displayName || "Anonymous" : "Anonymous");
      } catch {
        setUserName("Anonymous");
      }
    });
    return () => unsub();
  }, []);

  return userName;
}

// Pull live week/season from ESPN (pre/reg/post) + next game countdown
function useEspnWeekAndCountdown() {
  const [data, setData] = useState({
    seasonYear: null,
    week: null,
    seasonType: null,   // 'pre' | 'reg' | 'post'
    seasonLabel: "",
    countdown: "—",
  });

  useEffect(() => {
    let intervalId;

    const typeMap = {
      1: { code: "pre", label: "Preseason" },
      2: { code: "reg", label: "Regular Season" },
      3: { code: "post", label: "Postseason" },
    };

    async function load() {
      try {
        const res = await fetch("https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard");
        const json = await res.json();

        const seasonYear = json?.season?.year ?? null;
        const typeInfo = typeMap[json?.season?.type] || { code: null, label: "" };
        const week = json?.week?.number ?? null;

        // find next scheduled event for countdown
        const now = new Date();
        const events = Array.isArray(json?.events) ? json.events : [];
        const upcoming = events
          .map((e) => new Date(e?.date))
          .filter((d) => !isNaN(d.getTime()) && d > now)
          .sort((a, b) => a - b)[0];

        const tick = () => {
          if (!upcoming) {
            setData((prev) => ({ ...prev, countdown: "—" }));
            return;
          }
          const ms = upcoming.getTime() - new Date().getTime();
          if (ms <= 0) {
            setData((prev) => ({ ...prev, countdown: "Kickoff underway!" }));
            return;
          }
          const d = Math.floor(ms / 86_400_000);
          const h = Math.floor((ms / 3_600_000) % 24);
          const m = Math.floor((ms / 60_000) % 60);
          const s = Math.floor((ms / 1000) % 60);
          setData((prev) => ({
            ...prev,
            countdown: `${d}d ${h}h ${m}m ${s}s`,
          }));
        };

        setData({
          seasonYear,
          week,
          seasonType: typeInfo.code,   // 'pre' | 'reg' | 'post'
          seasonLabel: typeInfo.label, // 'Preseason', etc.
          countdown: "—",
        });

        tick();
        clearInterval(intervalId);
        intervalId = setInterval(tick, 1000);
      } catch (e) {
        setData((prev) => ({ ...prev, countdown: "—" }));
      }
    }

    load();
    return () => clearInterval(intervalId);
  }, []);

  return data; // { seasonYear, week, seasonType, seasonLabel, countdown }
}

function useLastWeekWinner(currentWeek, seasonYear) {
  const [winner, setWinner] = useState(null);

  const fetchWinner = useCallback(async (week) => {
    if (!seasonYear) return;
    const key = `${seasonYear}-W${week}`;

    const snap = await getDocs(collection(db, "picks"));
    let best = null;
    let maxCorrect = -1;

    for (const docSnap of snap.docs) {
      const data = docSnap.data()[key];
      if (!data) continue;
      const { displayName, tieBreaker, ...picks } = data;
      const correct = Object.values(picks).filter((v) => v === "✅").length;
      if (correct > maxCorrect) {
        maxCorrect = correct;
        best = { displayName, correct };
      }
    }
    setWinner(best);
  }, [seasonYear]);

  useEffect(() => {
    if (!currentWeek || !seasonYear) return;
    const last = Math.max(1, currentWeek - 1);
    fetchWinner(last);
  }, [currentWeek, seasonYear, fetchWinner]);

  return winner;
}

// ---- UI bits -----------------------------------------------

const ActionButton = React.memo(function ActionButton({ onClick, icon: Icon, label, disabled = false }) {
  return (
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
});

// ---- page --------------------------------------------------

export default function Dashboard() {
  const router = useRouter();
  const userName = useUserName();
  const { seasonYear, week: currentWeek, seasonType, seasonLabel, countdown } = useEspnWeekAndCountdown();
  const lastWeekWinner = useLastWeekWinner(currentWeek, seasonYear);

  const safeYear = seasonYear ?? new Date().getFullYear();
  const safeWeek = currentWeek ?? 1;

  // Tiny link helper
  const linkFor = (y, s, w, leaf) => `/${y}/${s}/${w}/${leaf}`;

  const go = useCallback(
    (path) => () => {
      if (!currentWeek || !seasonYear || !seasonType) return;
      router.push(path);
    },
    [router, currentWeek, seasonYear, seasonType]
  );

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-gradient-to-tr dark:from-gray-950 dark:to-gray-900 text-zinc-900 dark:text-white px-6 py-4 pb-32">
      <Head>
        <title>Dashboard | Early NFL</title>
      </Head>

      <div className="max-w-5xl mx-auto">
        <header className="mb-4">
          <h1 className="text-3xl font-extrabold">Hi, {userName}!</h1>
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
            <p className="text-base sm:text-xl font-bold text-indigo-600 dark:text-indigo-400">
              {seasonLabel && currentWeek
                ? `Week ${currentWeek} • ${seasonLabel}`
                : `Week ${currentWeek ?? "—"}`}
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 hidden sm:block">
              NFL {seasonYear ?? "—"}
            </p>
          </div>

          <div className="bg-white dark:bg-zinc-800/80 p-3 sm:p-4 rounded-xl border border-zinc-200 dark:border-zinc-700 shadow text-center">
            <h2 className="text-sm sm:text-base font-semibold mb-1">Next Game Countdown</h2>
            <p className="text-base sm:text-xl font-bold text-amber-600 dark:text-yellow-400">{countdown}</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 hidden sm:block">Until next kickoff</p>
          </div>

          {lastWeekWinner && (
            <div className="bg-white dark:bg-zinc-800/80 p-3 sm:p-4 rounded-xl border border-zinc-200 dark:border-zinc-700 shadow text-center">
              <h2 className="text-sm sm:text-base font-semibold mb-1">Last Week&apos;s Winner</h2>
              <p className="text-base sm:text-xl font-bold text-green-600 dark:text-green-400">
                {lastWeekWinner.displayName}
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 hidden sm:block">
                {lastWeekWinner.correct} correct picks
              </p>
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
            onClick={go(linkFor(safeYear, seasonType, safeWeek, "picks"))}
            icon={ClipboardList}
            label="Manage Your Picks"
            disabled={!currentWeek || !seasonYear || !seasonType}
          />
          <ActionButton
            onClick={go(linkFor(safeYear, seasonType, safeWeek, "results"))}
            icon={Calendar}
            label="This Week’s Results"
            disabled={!currentWeek || !seasonYear || !seasonType}
          />
          <ActionButton icon={Clock} label="Last Week’s Results" disabled />
          <ActionButton
            onClick={go(linkFor(safeYear, seasonType, safeWeek, "gamecenter"))}
            icon={PlayCircle}
            label="Game Center"
            disabled={!currentWeek || !seasonYear || !seasonType}
          />
          <ActionButton onClick={go("/leaderboard")} icon={TrendingUp} label="Leaderboard" />
          <ActionButton onClick={go("/profile")} icon={Settings} label="Settings" />
        </motion.section>
      </div>
    </div>
  );
}
