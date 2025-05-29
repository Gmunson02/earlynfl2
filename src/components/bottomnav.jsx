import Link from "next/link";
import { useRouter } from "next/router";
import { Home, List, Trophy, BarChart2, User } from "lucide-react";
import { useEffect, useState } from "react";

export default function BottomNav() {
  const router = useRouter();
  const [currentWeek, setCurrentWeek] = useState(null);
  const [currentYear, setCurrentYear] = useState(null);

  useEffect(() => {
    const today = new Date();
    const startOfSeason = new Date(today.getFullYear(), 8, 1); // Sept 1
    const weekNum = Math.max(
      1,
      Math.ceil((today - startOfSeason) / (7 * 24 * 60 * 60 * 1000))
    );
    setCurrentWeek(weekNum);
    setCurrentYear(today.getFullYear());
  }, []);

  const navItems = [
    { label: "Home", href: "/", icon: <Home size={22} /> },
    {
      label: "Picks",
      href: currentYear && currentWeek ? `/${currentYear}/${currentWeek}/picks` : "#",
      icon: <List size={22} />,
    },
    {
      label: "Results",
      href: currentYear && currentWeek ? `/${currentYear}/${currentWeek}/results` : "#",
      icon: <Trophy size={22} />,
    },
    { label: "Leaderboard", href: "/leaderboard", icon: <BarChart2 size={22} /> },
    { label: "Profile", href: "/profile", icon: <User size={22} /> },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 shadow-sm">
      <ul className="flex justify-around items-center h-16">
        {navItems.map((item) => {
          const isActive = router.asPath === item.href;
          return (
            <li key={item.label} className="flex flex-col items-center text-xs">
              <Link
                href={item.href}
                className={`flex flex-col items-center ${
                  isActive
                    ? "text-indigo-600 dark:text-indigo-400"
                    : "text-gray-500 dark:text-gray-400"
                }`}
              >
                {item.icon}
                <span className="mt-1 font-medium">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
