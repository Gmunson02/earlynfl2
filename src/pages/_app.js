import "../styles/globals.css";
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { auth, db } from "../lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import Head from "next/head";
import Layout from "@/components/Layout";
import { Toaster } from "react-hot-toast";

function MyApp({ Component, pageProps }) {
  const router = useRouter();
  const [theme, setTheme] = useState("light");
  const [hasDisplayName, setHasDisplayName] = useState(false);
  const [isReady, setIsReady] = useState(false);

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

      setIsReady(true);
    });

    return unsub;
  }, []);

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
            style: {
              background: "#333",
              color: "#fff",
            },
          }}
        />
      </Layout>
    </>
  );
}

export default MyApp;
