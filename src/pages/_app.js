// pages/_app.js
import "../styles/globals.css";
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import Layout from "@/components/Layout";
import { Toaster } from "react-hot-toast";

import { ThemeProvider, useTheme } from "next-themes";

import { auth, db } from "../lib/firebase";
import {
  onAuthStateChanged,
  setPersistence,
  indexedDBLocalPersistence,
  browserLocalPersistence,
} from "firebase/auth";
import { doc, getDoc, onSnapshot } from "firebase/firestore";

function AppInner({ Component, pageProps }) {
  const router = useRouter();
  const { setTheme } = useTheme();
  const [hasDisplayName, setHasDisplayName] = useState(false);
  const [isReady, setIsReady] = useState(false);

  // Register the Service Worker once on mount (PWA)
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .catch((err) => console.error("SW registration failed:", err));
    }
  }, []);

  // Firebase Auth persistence (browser only)
  useEffect(() => {
    setPersistence(auth, indexedDBLocalPersistence)
      .catch(() => setPersistence(auth, browserLocalPersistence))
      .catch(() => {});
  }, []);

  // Live theme + profile sync
  useEffect(() => {
    let unsubDoc = null;

    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      // clean up any previous doc listener when user changes
      if (unsubDoc) {
        unsubDoc();
        unsubDoc = null;
      }

      if (!user) {
        setHasDisplayName(false);
        setIsReady(true);
        return;
      }

      const ref = doc(db, "users", user.uid);

      // set initial values once (optional but snappy)
      try {
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const data = snap.data();
          if (data?.theme === "dark" || data?.theme === "light") {
            setTheme(data.theme);
          }
          setHasDisplayName(Boolean(data?.displayName));
        } else {
          setHasDisplayName(false);
        }
      } finally {
        setIsReady(true);
      }

      // then subscribe for live updates
      unsubDoc = onSnapshot(
        ref,
        (snap) => {
          const data = snap.data();
          if (data?.theme === "dark" || data?.theme === "light") {
            setTheme(data.theme); // updates instantly if doc changes anywhere
          }
          setHasDisplayName(Boolean(data?.displayName));
        },
        () => {
          // ignore errors for now; keep app usable
        }
      );
    });

    return () => {
      if (unsubDoc) unsubDoc();
      unsubAuth();
    };
  }, [setTheme]);

  const excludedRoutes = ["/", "/signin", "/guest"];
  const showBottomNav = isReady && !excludedRoutes.includes(router.pathname);

  return (
    <>
      <Head>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
      </Head>

      <Layout showBottomNav={showBottomNav}>
        <Component {...pageProps} />
        <Toaster
          position="top-center"
          toastOptions={{
            style: { background: "#333", color: "#fff" },
          }}
        />
      </Layout>
    </>
  );
}

export default function MyApp(props) {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
      <AppInner {...props} />
    </ThemeProvider>
  );
}
