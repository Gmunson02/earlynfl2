import "../styles/globals.css";
import { useEffect, useLayoutEffect, useState } from "react";
import { auth, db } from "../lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import BottomNav from "@/components/bottomnav";

function MyApp({ Component, pageProps }) {
  const [theme, setTheme] = useState("light");

  // ⚡ Immediately apply theme before render to avoid FOUC (flash of unstyled content)
  useLayoutEffect(() => {
    const stored = localStorage.getItem("theme");
    const initialTheme = stored === "dark" ? "dark" : "light";
    setTheme(initialTheme);
    document.documentElement.classList.remove("light", "dark");
    document.documentElement.classList.add(initialTheme);
  }, []);

  // 🎯 Reactively update theme if user logs in
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user && !user.isAnonymous) {
        const ref = doc(db, "users", user.uid);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const userTheme = snap.data().theme || "light";
          setTheme(userTheme);
          document.documentElement.classList.remove("light", "dark");
          document.documentElement.classList.add(userTheme);
          localStorage.setItem("theme", userTheme);
        }
      } else {
        setTheme("light");
        document.documentElement.classList.remove("light", "dark");
        document.documentElement.classList.add("light");
        localStorage.setItem("theme", "light");
      }
    });
    return unsub;
  }, []);

  return (
    <>
      <Component {...pageProps} />
      <BottomNav />
    </>
  );
}

export default MyApp;
