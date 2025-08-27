// pages/profile.js
import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/router";
import { auth, db } from "../lib/firebase";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { useTheme } from "next-themes";

export default function ProfilePage() {
  const router = useRouter();
  const { setTheme } = useTheme();
  const from = useMemo(() => router.query.from || "/dashboard", [router.query.from]);

  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    displayName: "",
    theme: "light",
  });

  // Derived validation state
  const isAnon = !!user?.isAnonymous;
  const fieldsOk = useMemo(() => {
    const dn = form.displayName?.trim();
    const fn = form.firstName?.trim();
    const ln = form.lastName?.trim();
    if (isAnon) return !!dn;
    return !!dn && !!fn && !!ln;
  }, [form, isAnon]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (!u) {
        router.replace("/");
        return;
      }

      try {
        const ref = doc(db, "users", u.uid);
        const snap = await getDoc(ref);

        if (snap.exists()) {
          const data = snap.data();
          setForm({
            firstName: data.firstName || "",
            lastName: data.lastName || "",
            displayName: data.displayName || "",
            theme: data.theme || "light",
          });
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
      } catch (e) {
        console.error(e);
        setError("Failed to load profile.");
      } finally {
        setLoading(false);
      }
    });

    return unsub;
  }, [router, setTheme]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
    if (error) setError("");
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!user) return;

    // Client-side required checks
    const dn = form.displayName.trim();
    const fn = form.firstName.trim();
    const ln = form.lastName.trim();

    if (!dn || (!isAnon && (!fn || !ln))) {
      setError(
        isAnon
          ? "Display Name is required."
          : "Display Name, First Name, and Last Name are required."
      );
      return;
    }

    setSaving(true);
    setError("");

    try {
      const ref = doc(db, "users", user.uid);
      const dataToSave = {
        displayName: dn,
        theme: form.theme,
        isGuest: user.isAnonymous,
        ...(user.isAnonymous ? {} : { firstName: fn, lastName: ln }),
      };

      await setDoc(ref, dataToSave, { merge: true });

      // Apply theme only after saving so nothing changes until Save
      if (form.theme === "light" || form.theme === "dark") {
        setTheme(form.theme);
      }

      // Redirect back to where they came from
      router.replace(typeof from === "string" ? from : "/dashboard");
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

        {!isAnon && (
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
          disabled={saving || !fieldsOk}
          className={`w-full bg-blue-600 text-white font-semibold py-2 rounded hover:bg-blue-700 ${
            saving || !fieldsOk ? "opacity-50 cursor-not-allowed" : ""
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
