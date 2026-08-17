import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { auth, db } from "../lib/firebase";
import {
  onAuthStateChanged,
  signInAnonymously,
  GoogleAuthProvider,
  linkWithPopup,
  signInWithPopup,
  signInWithCredential,
  signOut,
} from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import toast from "react-hot-toast";

export default function GuestPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);

  // Arriving with no session is the normal case. But if someone already has a
  // real (non-anonymous) session — e.g. a stale bookmark/tab from before they
  // signed up — send them straight to the dashboard instead of letting them
  // spin up an unrelated guest account on top of their real one.
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (u && !u.isAnonymous) {
        router.replace("/dashboard");
        return;
      }
      setUser(u);
    });
    return unsub;
  }, [router]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!displayName.trim()) return;

    setSaving(true);
    try {
      // Only create the anonymous session now that they've actually committed
      let currentUser = user;
      if (!currentUser) {
        const result = await signInAnonymously(auth);
        currentUser = result.user;
      }

      await setDoc(doc(db, "users", currentUser.uid), {
        displayName: displayName.trim(),
        isGuest: true,
        theme: "light",
      });
      router.push("/dashboard");
    } catch (err) {
      console.error("Failed to save guest info", err);
      toast.error("Something went wrong. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleGoogleUpgrade = async () => {
    setGoogleBusy(true);
    try {
      const provider = new GoogleAuthProvider();
      let cred;
      try {
        cred = user?.isAnonymous
          ? await linkWithPopup(user, provider)
          : await signInWithPopup(auth, provider);
      } catch (err) {
        if (err.code === "auth/credential-already-in-use") {
          // That Google account already belongs to a real account — sign into it instead
          const existingCredential = GoogleAuthProvider.credentialFromError(err);
          cred = await signInWithCredential(auth, existingCredential);
        } else {
          throw err;
        }
      }

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
      console.error("Google sign-up failed:", err);
      toast.error("Google sign-up failed. You can still continue as a guest below.");
    } finally {
      setGoogleBusy(false);
    }
  };

  const handleBack = async () => {
    // Fully sign out of the anonymous session — otherwise the landing page
    // keeps redirecting straight back here on every future visit.
    try {
      await signOut(auth);
    } finally {
      router.push("/");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900 px-4 py-8">
      <div className="w-full max-w-md space-y-4">
        <button
          onClick={handleBack}
          className="text-sm text-gray-600 dark:text-gray-300 hover:underline"
        >
          ← Back
        </button>

        <div className="bg-white dark:bg-gray-800 text-black dark:text-white p-5 rounded-xl shadow">
          <h2 className="font-bold text-center mb-1">For the best experience...</h2>
          <p className="text-sm text-center text-gray-600 dark:text-gray-300 mb-3">
            We recommend creating an account instead of playing as a guest:
          </p>
          <ul className="text-sm text-gray-600 dark:text-gray-300 space-y-1 mb-4 list-disc list-inside">
            <li>Your picks and stats are saved for the whole season</li>
            <li>Works even if you switch phones or clear your browser</li>
            <li>Shows up correctly on the leaderboard, no duplicate names</li>
          </ul>
          <button
            onClick={handleGoogleUpgrade}
            disabled={googleBusy}
            className="w-full flex items-center justify-center gap-2 border border-gray-300 dark:border-gray-600 py-2.5 rounded-lg font-semibold text-gray-800 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
              <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.62z"/>
              <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.98v2.33A9 9 0 0 0 9 18z"/>
              <path fill="#FBBC05" d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.7V4.97H.98A9 9 0 0 0 0 9c0 1.45.35 2.83.98 4.03l2.97-2.33z"/>
              <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .98 4.97L3.95 7.3C4.66 5.17 6.65 3.58 9 3.58z"/>
            </svg>
            {googleBusy ? "Connecting…" : "Continue with Google"}
          </button>
          <button
            onClick={() => router.push("/signin?mode=signup")}
            className="w-full mt-2 text-center text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            Or sign up with email instead
          </button>
        </div>

        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-gray-300 dark:bg-gray-600" />
          <span className="text-xs text-gray-500 dark:text-gray-400">OR CONTINUE AS GUEST</span>
          <div className="h-px flex-1 bg-gray-300 dark:bg-gray-600" />
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-white dark:bg-gray-800 text-black dark:text-white p-6 rounded-xl shadow space-y-4"
        >
          <label htmlFor="displayName" className="block text-sm font-medium mb-1">
            Enter a Display Name
          </label>
          <input
            id="displayName"
            name="displayName"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            className="w-full border px-3 py-2 rounded dark:bg-gray-700 dark:border-gray-600"
          />

          <button
            type="submit"
            disabled={saving}
            className={`w-full bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-white font-semibold py-2 rounded hover:bg-gray-300 dark:hover:bg-gray-600 ${
              saving ? "opacity-50 cursor-wait" : ""
            }`}
          >
            {saving ? "Saving..." : "Continue as Guest"}
          </button>
        </form>
      </div>
    </div>
  );
}
