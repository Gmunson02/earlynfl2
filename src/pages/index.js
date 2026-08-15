import { useRouter } from "next/router";
import { auth, db } from "../lib/firebase";
import { onAuthStateChanged, signInAnonymously, signInWithPopup, GoogleAuthProvider } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
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
      router.push("/signin?mode=signup");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    try {
      const cred = await signInWithPopup(auth, new GoogleAuthProvider());
      const ref = doc(db, "users", cred.user.uid);
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        await setDoc(ref, {
          displayName: cred.user.displayName || cred.user.email?.split("@")[0] || "",
          email: cred.user.email || "",
          theme: "light",
          createdAt: new Date().toISOString(),
        });
      }
      router.push("/dashboard");
    } catch (err) {
      console.error("Google sign-in failed:", err);
      alert("Google sign-in failed");
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

      <div className="space-y-3 w-full max-w-sm">
        <button
          onClick={handleGoogleSignIn}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 bg-white hover:bg-gray-50 text-gray-800 font-bold py-3 px-6 rounded-xl shadow border border-gray-200 disabled:opacity-50"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
            <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.62z"/>
            <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.98v2.33A9 9 0 0 0 9 18z"/>
            <path fill="#FBBC05" d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.7V4.97H.98A9 9 0 0 0 0 9c0 1.45.35 2.83.98 4.03l2.97-2.33z"/>
            <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .98 4.97L3.95 7.3C4.66 5.17 6.65 3.58 9 3.58z"/>
          </svg>
          Continue with Google
        </button>

        <button
          onClick={handleEmailSignIn}
          disabled={loading}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-xl shadow disabled:opacity-50"
        >
          Sign Up with Email
        </button>

        <p className="text-sm text-gray-600 dark:text-gray-300 pt-1">
          Already have an account?{" "}
          <button
            onClick={() => router.push("/signin")}
            className="font-semibold text-blue-600 dark:text-blue-400 hover:underline"
          >
            Log in
          </button>
        </p>

        <button
          onClick={handleGuest}
          disabled={loading}
          className="text-sm text-gray-500 dark:text-gray-400 hover:underline pt-2"
        >
          Continue as Guest
        </button>
      </div>
    </div>
  );
}
