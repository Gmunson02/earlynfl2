import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { auth } from "../lib/firebase";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInAnonymously,
} from "firebase/auth";

export default function Home() {
  const [user, setUser] = useState(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState("signin");
  const [error, setError] = useState("");
  const router = useRouter();

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setUser(user);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (user && !user.isAnonymous) {
      router.replace("/");
    }
  }, [user]);

  const handleAuth = async (e) => {
    e.preventDefault();
    setError("");

    try {
      if (mode === "signup") {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        router.push("/setup-profile");
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handleGuestLogin = async () => {
    try {
      await signInAnonymously(auth);
    } catch (err) {
      setError("Failed to continue as guest.");
      console.error(err);
    }
  };

  const handleSignOut = async () => {
    await auth.signOut();
    setUser(null);
  };

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-md p-6 bg-white rounded-xl shadow">
          <h2 className="text-xl font-bold mb-4">
            {mode === "signup" ? "Create Account" : "Sign In"}
          </h2>

          {error && <p className="text-red-500 text-sm mb-2">{error}</p>}

          <form onSubmit={handleAuth} className="space-y-4">
            <input
              type="email"
              placeholder="Email"
              className="w-full border border-gray-300 rounded px-3 py-2"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <input
              type="password"
              placeholder="Password"
              className="w-full border border-gray-300 rounded px-3 py-2"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button
              type="submit"
              className="w-full bg-blue-600 text-white rounded px-4 py-2 hover:bg-blue-700"
            >
              {mode === "signup" ? "Sign Up" : "Sign In"}
            </button>
          </form>

          <div className="mt-4 flex flex-col items-center space-y-2">
            <button
              className="text-sm text-blue-600 hover:underline"
              onClick={() => setMode(mode === "signup" ? "signin" : "signup")}
            >
              {mode === "signup"
                ? "Already have an account? Sign In"
                : "Don't have an account? Sign Up"}
            </button>

            <button
              className="text-sm text-gray-600 hover:underline"
              onClick={handleGuestLogin}
            >
              Or continue as Guest
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="max-w-2xl mx-auto bg-white shadow rounded-xl p-6">
        <h1 className="text-2xl font-bold mb-4 text-center">
          Welcome, {user.isAnonymous ? "Guest" : user.email}
        </h1>

        <div className="grid grid-cols-1 gap-4">
          <DashboardLink href="/2025/1/picks" label="Make This Week’s Picks" />
          <DashboardLink href="/scores/current" label="View Current Scores" />
          <DashboardLink href="/scores/last-week" label="See Last Week’s Results" />
          <DashboardLink href="/leaderboard" label="View Leaderboard" />
          <DashboardLink href="/profile" label="View Your Profile" />
        </div>

        <div className="mt-6 text-center">
          <button
            onClick={handleSignOut}
            className="text-sm text-red-600 hover:underline"
          >
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}

function DashboardLink({ href, label }) {
  const router = useRouter();

  return (
    <button
      onClick={() => router.push(href)}
      className="w-full text-left px-4 py-3 bg-blue-100 rounded-lg hover:bg-blue-200 transition"
    >
      {label}
    </button>
  );
}
