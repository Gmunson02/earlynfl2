import "../styles/globals.css";
import { useEffect, useState } from "react";
import { auth, db } from "../lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import BottomNav from "@/components/bottomnav";

function MyApp({ Component, pageProps }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true); // avoid hydration issues

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      let theme = "light";
      if (user && !user.isAnonymous) {
        const ref = doc(db, "users", user.uid);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          theme = snap.data().theme || "light";
        }
      }
      document.documentElement.classList.remove("light", "dark");
      document.documentElement.classList.add(theme);
    });

    return unsubscribe;
  }, []);

  // Don't render until mounted (prevents hydration mismatch)
  if (!mounted) return null;

  return (
    <>
      <Component {...pageProps} />
      <BottomNav />
    </>
  );
}

export default MyApp;
