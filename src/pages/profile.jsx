import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { auth, db } from "../lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";

export default function ProfilePage() {
    const router = useRouter();
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

    // Load current user
    useEffect(() => {
        const unsub = onAuthStateChanged(auth, async (user) => {
            if (!user || user.isAnonymous) {
                router.replace("/");
            } else {
                setUser(user);
                const ref = doc(db, "users", user.uid);
                const snap = await getDoc(ref);
                if (snap.exists()) {
                    setProfile(snap.data());
                    setForm({
                        firstName: snap.data().firstName || "",
                        lastName: snap.data().lastName || "",
                        displayName: snap.data().displayName || "",
                        theme: snap.data().theme || "light",
                    });
                }
                setLoading(false);
            }
        });
        return unsub;
    }, []);

    const handleChange = (e) => {
        setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
    };

    const handleSave = async (e) => {
        e.preventDefault();
        if (!user) return;
        setSaving(true);
        setError("");

        try {
            const ref = doc(db, "users", user.uid);
            await setDoc(ref, {
                ...form,
                isGuest: false,
            }, { merge: true });

            // ✅ Redirect to home/dashboard after save
            router.push("/");
        } catch (err) {
            setError("Failed to update profile.");
            console.error(err);
            setSaving(false);
        }
    };


    if (loading) {
        return <div className="p-4 text-center">Loading...</div>;
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-100 px-4">
            <form
                onSubmit={handleSave}
                className="bg-white p-6 rounded-xl shadow w-full max-w-md space-y-4"
            >
                <h1 className="text-xl font-bold text-center">Your Profile</h1>

                {error && <p className="text-red-500 text-sm text-center">{error}</p>}

                <input
                    name="firstName"
                    type="text"
                    placeholder="First Name"
                    value={form.firstName}
                    onChange={handleChange}
                    required
                    className="w-full border px-3 py-2 rounded"
                />
                <input
                    name="lastName"
                    type="text"
                    placeholder="Last Name"
                    value={form.lastName}
                    onChange={handleChange}
                    required
                    className="w-full border px-3 py-2 rounded"
                />
                <input
                    name="displayName"
                    type="text"
                    placeholder="Display Name"
                    value={form.displayName}
                    onChange={handleChange}
                    required
                    className="w-full border px-3 py-2 rounded"
                />

                <select
                    name="theme"
                    value={form.theme}
                    onChange={handleChange}
                    className="w-full border px-3 py-2 rounded"
                >
                    <option value="light">Light Mode</option>
                    <option value="dark">Dark Mode</option>
                </select>

                <button
                    type="submit"
                    disabled={saving}
                    className={`w-full bg-blue-600 text-white font-semibold py-2 rounded hover:bg-blue-700 ${saving ? "opacity-50 cursor-wait" : ""
                        }`}
                >
                    {saving ? "Saving..." : "Save Changes"}
                </button>
            </form>
        </div>
    );
}
