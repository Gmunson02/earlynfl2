import Link from "next/link";
import { useRouter } from "next/router";
import { Home, List, Trophy, PlayCircle, Settings } from "lucide-react";
import { useEffect, useState } from "react";

export default function BottomNav() {
  const router = useRouter();
  const [currentWeek, setCurrentWeek] = useState("1");

  useEffect(() => {
    const seasonStart = new Date("2025-09-05");
    const today = new Date();
    const diff = Math.floor((today - seasonStart) / (1000 * 60 * 60 * 24));
    const week = Math.max(1, Math.floor(diff / 7) + 1);
    setCurrentWeek(week.toString());
  }, []);

  const navItems = [
    { label: "Home", href: "/dashboard", icon: Home },
    { label: "Picks", href: `/2025/${currentWeek}/picks`, icon: List },
    { label: "Results", href: `/2025/${currentWeek}/results`, icon: Trophy },
    { label: "Game Center", href: `/2025/${currentWeek}/gamecenter`, icon: PlayCircle },
    { label: "Settings", href: "/profile", icon: Settings },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 shadow-sm min-h-[4rem] pb-[env(safe-area-inset-bottom)]">
      <ul className="flex justify-around items-center h-full">
        {navItems.map((item) => {
          const isActive = router.asPath === item.href;
          const Icon = item.icon;
          return (
            <li key={item.label} className="flex flex-col items-center text-xs">
              <Link href={item.href} className="flex flex-col items-center">
                <Icon
                  size={22}
                  className={
                    isActive
                      ? "text-indigo-600 dark:text-indigo-400"
                      : "text-gray-500 dark:text-gray-400"
                  }
                />
                <span
                  className={
                    isActive
                      ? "mt-1 text-indigo-600 dark:text-indigo-400 font-medium"
                      : "mt-1 text-gray-500 dark:text-gray-400"
                  }
                >
                  {item.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
