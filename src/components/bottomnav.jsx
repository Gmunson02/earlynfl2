import Link from "next/link";
import { useRouter } from "next/router";
import { Home, List, Trophy, Swords, Settings } from "lucide-react";
import { useMemo } from "react";
import useScheduleWeek from "../hooks/useScheduleWeek";

export default function BottomNav() {
  const router = useRouter();
  const { seasonYear, seasonType, value: week, isBeforeKickoff } = useScheduleWeek("nfl-2026");

  // Preseason is a free-editing beta period — no kickoff deadline
  const picksOpen = isBeforeKickoff || seasonType === "pre";

  const buildWeekPath = (y, s, w, leaf) =>
    y && s && w && leaf ? `/${y}/${s}/${w}/${leaf}` : null;

  // Picks close once the week's first game kicks off (except preseason) —
  // same rule enforced server-side
  const picksHref = useMemo(
    () => (picksOpen ? buildWeekPath(seasonYear, seasonType, week, "picks") : null),
    [seasonYear, seasonType, week, picksOpen]
  );

  const resultsHref = useMemo(
    () => buildWeekPath(seasonYear, seasonType, week, "results"),
    [seasonYear, seasonType, week]
  );

  const rivalsHref = useMemo(
    () => buildWeekPath(seasonYear, seasonType, week, "rivals"),
    [seasonYear, seasonType, week]
  );

  // Settings should return you to wherever you were, not always /dashboard.
  // Guard against re-wrapping while already on /profile (its asPath already
  // carries a ?from= param, which would otherwise nest on every render).
  const settingsHref = useMemo(
    () =>
      router.pathname === "/profile" ? router.asPath : `/profile?from=${encodeURIComponent(router.asPath)}`,
    [router.asPath, router.pathname]
  );

  const navItems = [
    { label: "Home", href: "/dashboard", icon: Home, ready: true },
    { label: "Picks", href: picksHref, icon: List, ready: !!picksHref },
    { label: "Results", href: resultsHref, icon: Trophy, ready: !!resultsHref },
    { label: "Rivals", href: rivalsHref, icon: Swords, ready: !!rivalsHref },
    { label: "Settings", href: settingsHref, icon: Settings, ready: true },
  ];

  return (
    <nav
      // removed `transform-gpu` to avoid iOS PWA hairline artifact
      className="fixed bottom-0 inset-x-0 z-50 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 shadow-md h-22 pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="flex justify-evenly items-center h-full">
        {navItems.map((item) => {
          const isActive = item.href ? router.asPath.startsWith(item.href) : false;
          const Icon = item.icon;

          const content = (
            <>
              <Icon
                size={22}
                className={
                  isActive
                    ? "text-indigo-600 dark:text-indigo-400"
                    : "text-gray-500 dark:text-gray-400"
                }
                // create a local layer to avoid compositing seams on svg in PWA
                style={{ WebkitBackfaceVisibility: "hidden", backfaceVisibility: "hidden" }}
              />
              <span
                className={
                  (isActive
                    ? "mt-1 text-indigo-600 dark:text-indigo-400 font-medium"
                    : "mt-1 text-gray-500 dark:text-gray-400") + " leading-none"
                }
              >
                {item.label}
              </span>
            </>
          );

          return (
            <li key={item.label} className="flex flex-col items-center text-xs">
              {item.ready ? (
                <Link
                  href={item.href}
                  // hard-kill any underline/decoration that iOS might force in PWA
                  className="flex flex-col items-center !no-underline [text-decoration:none!important] [text-decoration-skip-ink:none] [text-decoration-thickness:0]"
                >
                  {content}
                </Link>
              ) : (
                <span
                  aria-disabled
                  className="flex flex-col items-center opacity-50 cursor-not-allowed !no-underline [text-decoration:none!important] [text-decoration-skip-ink:none] [text-decoration-thickness:0]"
                  title={item.label === "Picks" && !picksOpen ? "Picks are closed for this week" : "Loading week…"}
                >
                  {content}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

