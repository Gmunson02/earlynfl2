import "../styles/globals.css";
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { auth, db } from "../lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import BottomNav from "@/components/bottomnav";
import Head from "next/head";

function MyApp({ Component, pageProps }) {
  const router = useRouter();
  const [theme, setTheme] = useState("light");
  const [hasDisplayName, setHasDisplayName] = useState(false);
  const [isReady, setIsReady] = useState(false); // 🆕 Indicates auth/data are loaded

  useEffect(() => {
    const stored = localStorage.getItem("theme");
    const initialTheme = stored === "dark" ? "dark" : "light";
    setTheme(initialTheme);
    document.documentElement.classList.remove("light", "dark");
    document.documentElement.classList.add(initialTheme);
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        const ref = doc(db, "users", user.uid);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const data = snap.data();
          const userTheme = data.theme || "light";
          setTheme(userTheme);
          document.documentElement.classList.remove("light", "dark");
          document.documentElement.classList.add(userTheme);
          localStorage.setItem("theme", userTheme);
          setHasDisplayName(Boolean(data.displayName));
        } else {
          setHasDisplayName(false);
        }
      } else {
        setHasDisplayName(false);
      }

      setIsReady(true); // ✅ Now we’re ready to show the nav
    });

    return unsub;
  }, []);

  const excludedRoutes = ["/", "/signin", "/guest"];
  const showBottomNav =
    !excludedRoutes.includes(router.pathname) && hasDisplayName;

  return (
    <>
      <Head>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
      </Head>

      <Component {...pageProps} />

      {isReady && showBottomNav && <BottomNav />}
    </>
  );
}

export default MyApp;
