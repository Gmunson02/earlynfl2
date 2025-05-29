import "../styles/globals.css";
import { useEffect, useState } from "react";
import { auth, db } from "../lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import BottomNav from "@/components/bottomnav";

function MyApp({ Component, pageProps }) {
  const [theme, setTheme] = useState("light");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user && !user.isAnonymous) {
        const ref = doc(db, "users", user.uid);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const userTheme = snap.data().theme;
          setTheme(userTheme === "dark" ? "dark" : "light");
        }
      } else {
        setTheme("light"); // guests default to light
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      document.documentElement.classList.remove("light", "dark");
      document.documentElement.classList.add(theme);
    }
  }, [theme]);

  return (
    <>
      <Component {...pageProps} />
      <BottomNav />
    </>
  );
}

export default MyApp;
