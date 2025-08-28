import Link from "next/link";
import { useRouter } from "next/router";
import { Home, List, Trophy, PlayCircle, Settings } from "lucide-react";
import { useEffect, useState, useMemo } from "react";

function useEspnWeek() {
  const [state, setState] = useState({
    seasonYear: null,
    week: null,
    seasonType: null, // 'pre' | 'reg' | 'post'
  });

  useEffect(() => {
    let alive = true;
    const typeMap = { 1: "pre", 2: "reg", 3: "post" };

    (async () => {
      try {
        const res = await fetch(
          "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"
        );
        const json = await res.json();
        if (!alive) return;

        setState({
          seasonYear: json?.season?.year ?? null,
          week: json?.week?.number ?? null,
          seasonType: typeMap[json?.season?.type] ?? null,
        });
      } catch {
        if (alive) setState({ seasonYear: null, week: null, seasonType: null });
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  return state;
}

export default function BottomNav() {
  const router = useRouter();
  const { seasonYear, week, seasonType } = useEspnWeek();

  const buildWeekPath = (y, s, w, leaf) =>
    y && s && w && leaf ? `/${y}/${s}/${w}/${leaf}` : null;

  const picksHref = useMemo(
    () => buildWeekPath(seasonYear, seasonType, week != null ? String(week) : null, "picks"),
    [seasonYear, seasonType, week]
  );

  const resultsHref = useMemo(
    () => buildWeekPath(seasonYear, seasonType, week != null ? String(week) : null, "results"),
    [seasonYear, seasonType, week]
  );

  const matchupsHref = useMemo(
    () => buildWeekPath(seasonYear, seasonType, week != null ? String(week) : null, "gamecenter"),
    [seasonYear, seasonType, week]
  );

  const navItems = [
    { label: "Home", href: "/dashboard", icon: Home, ready: true },
    { label: "Picks", href: picksHref, icon: List, ready: !!picksHref },
    { label: "Results", href: resultsHref, icon: Trophy, ready: !!resultsHref },
    { label: "Matchups", href: matchupsHref, icon: PlayCircle, ready: !!matchupsHref },
    { label: "Settings", href: "/profile", icon: Settings, ready: true },
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
                  title="Loading week…"
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

