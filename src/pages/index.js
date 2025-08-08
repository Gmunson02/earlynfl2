import { useRouter } from "next/router";
import { auth, db } from "../lib/firebase";
import { onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { useEffect, useState } from "react";
import Head from "next/head";
import Image from "next/image";

export default function HomePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let canceled = false;

    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setHydrated(true); // show landing
        return;
      }

      try {
        if (!user.isAnonymous) {
          if (!canceled) router.replace("/dashboard");
          return;
        }

        // Anonymous: check profile for displayName
        const snap = await getDoc(doc(db, "users", user.uid));
        const hasDisplayName = snap.exists() && !!snap.data()?.displayName;

        if (!canceled) {
          router.replace(hasDisplayName ? "/dashboard" : "/guest");
        }
      } finally {
        if (!canceled) setHydrated(true);
      }
    });

    return () => {
      canceled = true;
      unsub();
    };
  }, [router]);

  const handleEmailSignIn = async () => {
    setLoading(true);
    try {
      router.push("/signin");
    } finally {
      setLoading(false);
    }
  };

  const handleGuest = async () => {
    setLoading(true);
    try {
      // If already signed in, route based on profile
      const u = auth.currentUser;
      if (u) {
        if (!u.isAnonymous) return router.push("/dashboard");
        // anon: send to onboarding; dashboard gate happens after they set a name
        return router.push("/guest");
      }
      // Create anon user, then to onboarding
      await signInAnonymously(auth);
      router.push("/guest");
    } catch (err) {
      console.error("Guest sign-in failed:", err);
      alert("Guest sign-in failed");
    } finally {
      setLoading(false);
    }
  };

  if (!hydrated) return null;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center text-center bg-gradient-to-b from-gray-100 to-white dark:from-gray-900 dark:to-gray-800 px-6 pb-24">
      <Head>
        <title>EarlyNFL | Pick 'Em Challenge</title>
      </Head>

      <h1 className="text-4xl sm:text-5xl font-extrabold text-gray-800 dark:text-white mb-10">
        Early NFL
      </h1>

      <div className="mb-6">
        <Image
          src="/David.png"
          alt="Founder David Early"
          width={300}
          height={400}
          className="rounded-full shadow-lg mx-auto w-[200px] h-auto sm:w-[350px]"
        />
      </div>

      <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-800 dark:text-white mb-10">
        Make Your Picks.
        <br />
        Dominate the Week.
      </h2>

      <div className="space-y-4 w-full max-w-sm">
        <button
          onClick={handleEmailSignIn}
          disabled={loading}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-xl shadow disabled:opacity-50"
        >
          Sign In / Up via Email
        </button>

        <button
          onClick={handleGuest}
          disabled={loading}
          className="w-full bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-white font-medium py-3 px-6 rounded-xl shadow"
        >
          Continue as Guest
        </button>
      </div>
    </div>
  );
}
