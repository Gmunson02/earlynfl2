import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Sun, Moon } from "lucide-react";
import { auth, db } from "../lib/firebase";
import { doc, setDoc } from "firebase/firestore";

export default function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Avoid a hydration mismatch — theme isn't known until after mount
  useEffect(() => setMounted(true), []);

  const toggle = async () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    const uid = auth.currentUser?.uid;
    if (uid) {
      try {
        await setDoc(doc(db, "users", uid), { theme: next }, { merge: true });
      } catch {
        // non-critical — local theme already applied
      }
    }
  };

  if (!mounted) return null;

  return (
    <button
      onClick={toggle}
      aria-label="Toggle dark mode"
      title="Toggle dark mode"
      className="fixed bottom-24 right-4 z-40 p-2.5 rounded-full bg-white/90 dark:bg-zinc-800/90 border border-zinc-200 dark:border-zinc-700 shadow-lg backdrop-blur-sm hover:bg-white dark:hover:bg-zinc-700"
    >
      {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
