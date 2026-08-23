// src/pages/dashboard.js
import React, { useEffect, useCallback, useMemo, useState } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "../lib/firebase";
import { doc, getDoc } from "firebase/firestore";
import {
  Calendar,
  ClipboardList,
  Clock,
  TrendingUp,
  Settings,
  PlayCircle,
  ShieldCheck,
  ArrowLeftRight,
} from "lucide-react";
import { motion } from "framer-motion";
import useRequireProfile from "../hooks/useRequireProfile";
import useScheduleWeek from "../hooks/useScheduleWeek";
import useIsAdmin from "../hooks/useIsAdmin";
import { fetchDisplayNameMap } from "../lib/liveDisplayNames";
import InstallPrompt from "../components/InstallPrompt";

// ---- hooks -------------------------------------------------

// null = not resolved yet. Don't seed this with "Guest" — that renders a
// confidently wrong greeting to signed-in users for the first moment.
function useUserName() {
  const [userName, setUserName] = useState(null);
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

/**
 * Reads last week's winner given the current results week number (ESPN value).
 */
// Live display names, so a rename shows up on old results. Deliberately not
// dependent on the schedule — it starts on mount and resolves alongside it
// rather than queueing up behind it.
function useDisplayNameMap() {
  const [nameMap, setNameMap] = useState(null);

  useEffect(() => {
    let alive = true;
    fetchDisplayNameMap()
      .then((m) => alive && setNameMap(m))
      .catch((e) => {
        console.error("display name map failed", e);
        if (alive) setNameMap(new Map()); // fall back to stored names
      });
    return () => {
      alive = false;
    };
  }, []);

  return nameMap;
}

/**
 * Last week's winner, built from the weekly_results useScheduleWeek has
 * already loaded. This used to issue its own getDoc, which couldn't even
 * start until the schedule resolved — so this card always landed a beat
 * after the other two.
 */
function useLastWeekWinner({ weeklyResults, value, seasonYear, seasonType, nameMap }) {
  return useMemo(() => {
    const wVal = Number(value);
    if (!wVal || !seasonYear || !seasonType || !weeklyResults) return null;

    const prevWeek = Math.max(1, wVal - 1);
    const d = weeklyResults.get(`${seasonYear}-${seasonType}-W${prevWeek}`);
    if (!d) return null;

    const standings = Array.isArray(d.standings) ? d.standings : [];
    const winnersRaw = Array.isArray(d.winners) ? d.winners : [];

    const winnersNorm = winnersRaw.map((w) =>
      typeof w === "string"
        ? { uid: w, displayName: w }
        : { uid: w.uid, displayName: w.displayName || w.uid }
    );

    const winners = winnersNorm.map((w) => {
      const s = standings.find((x) => x.uid === w.uid);
      return {
        // Render the stored name until live names arrive, rather than
        // holding the whole card back for them.
        displayName: nameMap?.get(w.uid) || w.displayName,
        correctPicks: s?.wins ?? null,
        tieBreaker: s?.tieBreaker ?? null,
      };
    });

    return {
      week: prevWeek,
      lastGameTotal: d.lastGameTotal ?? null,
      winners,
    };
  }, [weeklyResults, value, seasonYear, seasonType, nameMap]);
}

// ---- UI bits -----------------------------------------------

// One color identity per action, shared between light and dark — light gets
// a tinted badge (pastel bg, saturated text) that reads well on white; dark
// gets the neon-on-black treatment. Keyed by name so call sites don't repeat
// long class strings, and so the light/dark pairing for a given action can't
// drift apart from each other.
const ACCENT_COLORS = {
  sky: { light: "bg-sky-100 text-sky-600", dark: "dark:bg-sky-500/20 dark:text-sky-400" },
  emerald: { light: "bg-emerald-100 text-emerald-600", dark: "dark:bg-lime-500/20 dark:text-lime-400" },
  violet: { light: "bg-violet-100 text-violet-600", dark: "dark:bg-violet-500/20 dark:text-violet-400" },
  rose: { light: "bg-rose-100 text-rose-600", dark: "dark:bg-rose-500/20 dark:text-rose-400" },
  amber: { light: "bg-amber-100 text-amber-600", dark: "dark:bg-yellow-500/20 dark:text-yellow-300" },
  orange: { light: "bg-orange-100 text-orange-600", dark: "dark:bg-orange-500/20 dark:text-orange-400" },
  indigo: { light: "bg-indigo-100 text-indigo-600", dark: "dark:bg-indigo-500/20 dark:text-indigo-400" },
  zinc: { light: "bg-zinc-100 text-zinc-500", dark: "dark:bg-zinc-500/20 dark:text-zinc-300" },
};

const ActionButton = React.memo(function ActionButton({
  onClick,
  icon: Icon,
  label,
  disabled = false,
  color = "zinc",
}) {
  const accent = ACCENT_COLORS[color] || ACCENT_COLORS.zinc;
  return (
    <motion.button
      whileHover={!disabled ? { scale: 1.05 } : {}}
      whileTap={!disabled ? { scale: 0.97 } : {}}
      onClick={onClick}
      disabled={disabled}
      className={`p-4 rounded-xl flex items-center gap-3 justify-start w-full text-left transition-all border border-zinc-200 dark:border-transparent shadow-md backdrop-blur-md ${
        disabled
          ? "bg-zinc-300 text-zinc-500 cursor-not-allowed dark:bg-zinc-900 dark:text-zinc-600"
          : "bg-white hover:bg-zinc-100 text-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800 dark:text-white"
      }`}
    >
      <span
        className={`flex items-center justify-center w-9 h-9 rounded-full ${
          disabled ? "bg-zinc-200 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-600" : `${accent.light} ${accent.dark}`
        }`}
      >
        <Icon size={20} />
      </span>
      <span className="font-semibold">{label}</span>
    </motion.button>
  );
});

// ---- page --------------------------------------------------

export default function Dashboard() {
  const router = useRouter();
  const userName = useUserName();

  // Call hooks unconditionally to keep hook order stable
  const profileStatus = useRequireProfile(); // "checking" | "ok" | "redirected"
  const adminStatus = useIsAdmin(); // "checking" | "admin" | "not-admin"

  const {
    loading,
    seasonYear,
    seasonType,
    displayLabel,
    value,
    countdown,
    prevWeekValue,
    isBeforeKickoff, // NEW
    weeklyResults,
  } = useScheduleWeek("nfl-2026");

  const picksOpen = isBeforeKickoff;

  const nameMap = useDisplayNameMap();
  const lastWeek = useLastWeekWinner({
    weeklyResults,
    value,
    seasonYear,
    seasonType,
    nameMap,
  });
  const hasLastWeekWinner = !!lastWeek && lastWeek.winners?.length > 0;

  // Define hooks BEFORE any conditional return
  const safeYear = seasonYear ?? new Date().getFullYear();
  const linkFor = (y, s, w, leaf) => `/${y}/${s}/${w}/${leaf}`;

  const go = useCallback(
    (path) => () => {
      if (!seasonYear || !seasonType) return;
      router.push(path);
    },
    [router, seasonYear, seasonType]
  );

  // Only now is it safe to conditionally return early
  if (profileStatus === "checking") {
    return null; // or a tiny skeleton
  }

  // Routing helpers (always use ESPN value in regular season)
  const routeWeekPicks = value ?? "1";
  const routeWeekResultsThis = value ?? "1";
  const routeWeekResultsPrev =
    prevWeekValue ?? (value ? String(Math.max(1, Number(value) - 1)) : "1");

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black text-zinc-900 dark:text-white px-6 py-4 pb-32">
      <Head>
        <title>Dashboard | Early NFL</title>
      </Head>

      <div className="max-w-5xl mx-auto">
        <header className="mb-4">
          <h1 className="text-3xl font-extrabold">{userName ? `Hi, ${userName}!` : "Hi!"}</h1>
        </header>

        <InstallPrompt />

        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className={`grid grid-cols-1 gap-3 sm:gap-4 mb-6 ${
            hasLastWeekWinner ? "md:grid-cols-3" : "md:grid-cols-2"
          }`}
        >
          {/* Current week — light mode gets a tinted card (sky) instead of
              plain white, so each stat has its own color identity in both
              themes, not just dark. */}
          <div className="bg-sky-50 dark:bg-zinc-900 p-3 sm:p-4 rounded-xl dark:rounded-2xl border border-sky-200 dark:border-transparent shadow-sm dark:shadow-none text-center">
            <h2 className="text-sm sm:text-base font-semibold mb-1">Current Week</h2>
            <p className="text-base sm:text-xl font-extrabold dark:font-black text-sky-600 dark:text-sky-400">
              {/* Never fall back to `Week ${value}` — that's ESPN's week
                  number, not our label (Preseason Week 2 is ESPN week 3). */}
              {loading ? "…" : displayLabel || "—"}
            </p>
          </div>

          {/* Countdown — once the first game of the week has kicked off,
              isBeforeKickoff goes false and countdown itself just reads
              "—" (see useScheduleWeek), which doesn't tell you WHY there's
              no countdown. Swap the whole card to an explicit locked
              message instead of a blank dash. Card tint follows the same
              state: amber while counting, rose once locked. */}
          <div
            className={`p-3 sm:p-4 rounded-xl dark:rounded-2xl border shadow-sm dark:shadow-none text-center dark:bg-zinc-900 dark:border-transparent ${
              !loading && !isBeforeKickoff
                ? "bg-rose-50 border-rose-200"
                : "bg-amber-50 border-amber-200"
            }`}
          >
            <h2 className="text-sm sm:text-base font-semibold mb-1">
              {loading || isBeforeKickoff ? "Countdown to Kickoff" : "Picks Locked"}
            </h2>
            {loading ? (
              <p className="text-base sm:text-xl font-extrabold dark:font-black text-amber-600 dark:text-yellow-300">…</p>
            ) : isBeforeKickoff ? (
              <>
                <p className="text-base sm:text-xl font-extrabold dark:font-black text-amber-600 dark:text-yellow-300">
                  {countdown}
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Picks lock at kickoff of the first game
                </p>
              </>
            ) : (
              <p className="text-base sm:text-xl font-extrabold dark:font-black text-rose-600 dark:text-rose-400">
                🔒 Picks Locked 🔒
              </p>
            )}
          </div>

          {/* Last week's winner(s). Nothing shows here until the first week
              of the season has been computed — deliberately no last-season
              fallback. */}
          {hasLastWeekWinner ? (
            <div className="bg-emerald-50 dark:bg-zinc-900 p-3 sm:p-4 rounded-xl dark:rounded-2xl border border-emerald-200 dark:border-transparent shadow-sm dark:shadow-none text-center">
              <h2 className="text-sm sm:text-base font-semibold mb-2">
                Last Week&apos;s Winner{lastWeek.winners.length > 1 ? "s" : ""}
              </h2>

              <div className="space-y-1">
                {lastWeek.winners.map((w, i) => (
                  <div key={`${w.displayName}-${i}`}>
                    <p className="text-base sm:text-xl font-extrabold dark:font-black text-emerald-600 dark:text-lime-400 mb-1">
                      {w.displayName}
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {w.correctPicks ?? "—"} correct • TB: {w.tieBreaker ?? "—"}
                      {lastWeek.lastGameTotal != null && ` (Final: ${lastWeek.lastGameTotal})`}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </motion.section>

        {/* Actions */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"
        >
          <ActionButton
            onClick={go(linkFor(safeYear, seasonType, routeWeekPicks, "picks"))}
            icon={ClipboardList}
            label="Manage Your Picks"
            color="sky"
            disabled={
              !seasonYear ||
              !seasonType ||
              !routeWeekPicks ||
              !picksOpen
            }
          />
          <ActionButton
            onClick={go(linkFor(safeYear, seasonType, routeWeekResultsThis, "results"))}
            icon={Calendar}
            label="This Week’s Results"
            color="emerald"
            disabled={!seasonYear || !seasonType || !routeWeekResultsThis}
          />
          <ActionButton
            onClick={go(linkFor(safeYear, seasonType, routeWeekPicks, "rivals"))}
            icon={ArrowLeftRight}
            label="Compare"
            color="violet"
            disabled={!seasonYear || !seasonType || !routeWeekPicks}
          />
          <ActionButton
            onClick={go(linkFor(safeYear, seasonType, routeWeekPicks, "gamecenter"))}
            icon={PlayCircle}
            label="Game Center"
            color="rose"
            disabled={!seasonYear || !seasonType || !routeWeekPicks}
          />
          <ActionButton
            onClick={go(linkFor(safeYear, seasonType, routeWeekResultsPrev, "results"))}
            icon={Clock}
            label="Last Week’s Results"
            color="amber"
          />
          <ActionButton
            onClick={() => router.push("/leaderboard")}
            icon={TrendingUp}
            label="Leaderboard"
            color="orange"
          />
          <ActionButton
            onClick={() => router.push("/profile")}
            icon={Settings}
            label="Settings"
          />
          {adminStatus === "admin" && (
            <ActionButton
              onClick={() => router.push("/admin")}
              icon={ShieldCheck}
              label="Admin"
              color="indigo"
            />
          )}
        </motion.section>
      </div>
    </div>
  );
}
