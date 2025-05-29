import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { auth, db } from "../lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";

export default function GuestPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) {
        router.replace("/");
      } else {
        setUser(u);
      }
    });
    return unsub;
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!displayName.trim()) return;

    setSaving(true);
    try {
      await setDoc(doc(db, "users", user.uid), {
        displayName: displayName.trim(),
        isGuest: true,
        theme: "light",
      });
      router.push("/dashboard");
    } catch (err) {
      console.error("Failed to save guest info", err);
      alert("Something went wrong. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900 px-4">
      <form
        onSubmit={handleSubmit}
        className="bg-white dark:bg-gray-800 text-black dark:text-white p-6 rounded-xl shadow w-full max-w-md space-y-4"
      >
        <h1 className="text-xl font-bold text-center">Continue as Guest</h1>

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
          className={`w-full bg-blue-600 text-white font-semibold py-2 rounded hover:bg-blue-700 ${
            saving ? "opacity-50 cursor-wait" : ""
          }`}
        >
          {saving ? "Saving..." : "Continue"}
        </button>
      </form>
    </div>
  );
}
