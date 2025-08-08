// pages/profile.js
import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { auth, db } from "../lib/firebase";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { useTheme } from "next-themes";

export default function ProfilePage() {
  const router = useRouter();
  const { setTheme } = useTheme();

  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    displayName: "",
    theme: "light",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (!u) {
        router.replace("/");
        return;
      }

      const ref = doc(db, "users", u.uid);
      const snap = await getDoc(ref);

      if (snap.exists()) {
        const data = snap.data();
        setProfile(data);
        setForm({
          firstName: data.firstName || "",
          lastName: data.lastName || "",
          displayName: data.displayName || "",
          theme: data.theme || "light",
        });
        // Ensure the app reflects the currently saved theme on load
        if (data?.theme === "light" || data?.theme === "dark") {
          setTheme(data.theme);
        }
      } else {
        setForm({
          firstName: "",
          lastName: "",
          displayName: "",
          theme: "light",
        });
      }

      setLoading(false);
    });

    return unsub;
  }, [router, setTheme]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value })); // no theme preview here
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!user) return;

    setSaving(true);
    setError("");

    try {
      const ref = doc(db, "users", user.uid);
      const dataToSave = {
        displayName: form.displayName,
        theme: form.theme,
        isGuest: user.isAnonymous,
        ...(user.isAnonymous
          ? {}
          : {
              firstName: form.firstName,
              lastName: form.lastName,
            }),
      };

      await setDoc(ref, dataToSave, { merge: true });

      // Apply theme only after saving so nothing changes until Save
      if (form.theme === "light" || form.theme === "dark") {
        setTheme(form.theme);
      }

      router.push("/dashboard");
    } catch (err) {
      console.error(err);
      setError("Failed to update profile.");
      setSaving(false);
    }
  };

  const handleSignOut = async () => {
    await signOut(auth);
    router.push("/");
  };

  if (loading) return <div className="p-4 text-center">Loading...</div>;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 px-4 dark:bg-gray-900">
      <form
        onSubmit={handleSave}
        className="bg-white dark:bg-gray-800 text-black dark:text-white p-6 rounded-xl shadow w-full max-w-md space-y-4"
      >
        <h1 className="text-xl font-bold text-center">Your Profile</h1>

        {error && <p className="text-red-500 text-sm text-center">{error}</p>}

        <div>
          <label htmlFor="displayName" className="block text-sm font-medium mb-1">
            Display Name {user?.isAnonymous && "(for guests)"}
          </label>
          <input
            id="displayName"
            name="displayName"
            type="text"
            value={form.displayName}
            onChange={handleChange}
            required
            className="w-full border px-3 py-2 rounded dark:bg-gray-700 dark:border-gray-600"
          />
        </div>

        {!user?.isAnonymous && (
          <>
            <div>
              <label htmlFor="firstName" className="block text-sm font-medium mb-1">
                First Name
              </label>
              <input
                id="firstName"
                name="firstName"
                type="text"
                value={form.firstName}
                onChange={handleChange}
                required
                className="w-full border px-3 py-2 rounded dark:bg-gray-700 dark:border-gray-600"
              />
            </div>

            <div>
              <label htmlFor="lastName" className="block text-sm font-medium mb-1">
                Last Name
              </label>
              <input
                id="lastName"
                name="lastName"
                type="text"
                value={form.lastName}
                onChange={handleChange}
                required
                className="w-full border px-3 py-2 rounded dark:bg-gray-700 dark:border-gray-600"
              />
            </div>
          </>
        )}

<div>
  <label htmlFor="theme" className="block text-sm font-medium mb-1">
    Theme Preference
  </label>
  <select
  id="theme"
  name="theme"
  value={form.theme}
  onChange={handleChange}
  className="w-full border px-3 py-2 rounded dark:bg-gray-700 bg-white dark:border-gray-600 border-gray-300 text-black dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
>
  <option value="light">Light Mode</option>
  <option value="dark">Dark Mode</option>
</select>
</div>

        <button
          type="submit"
          disabled={saving}
          className={`w-full bg-blue-600 text-white font-semibold py-2 rounded hover:bg-blue-700 ${
            saving ? "opacity-50 cursor-wait" : ""
          }`}
        >
          {saving ? "Saving..." : "Save Changes"}
        </button>

        <button
          type="button"
          onClick={handleSignOut}
          className="w-full bg-red-600 text-white font-semibold py-2 rounded hover:bg-red-700"
        >
          Sign Out
        </button>
      </form>
    </div>
  );
}
