// pages/profile.js
import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/router";
import { auth, db } from "../lib/firebase";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, getDoc, setDoc, collection, query, where, getDocs, deleteDoc } from "firebase/firestore";
import { useTheme } from "next-themes";
import toast from "react-hot-toast";
import { UserPen, Trash2, Plus, Users } from "lucide-react";
import RenameModal from "../components/RenameModal";

// ---- Family Members: add/rename/remove profiles you manage picks for ----
function FamilyMembersCard({ ownerUid }) {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [renamingMember, setRenamingMember] = useState(null); // {id, displayName} | null
  const [removingMember, setRemovingMember] = useState(null); // {id, displayName} | null
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    if (!ownerUid) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const q = query(collection(db, "users"), where("managedBy", "==", ownerUid));
      const snap = await getDocs(q);
      if (cancelled) return;
      setMembers(snap.docs.map((d) => ({ id: d.id, displayName: d.data().displayName || "" })));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [ownerUid]);

  const handleAdd = async (e) => {
    e.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed) return;
    setAdding(true);
    try {
      const ref = doc(collection(db, "users"));
      await setDoc(ref, { displayName: trimmed, managedBy: ownerUid, isGuest: true, theme: "light" });
      setMembers((prev) => [...prev, { id: ref.id, displayName: trimmed }]);
      setNewName("");
      toast.success(`Added ${trimmed}`);
    } catch (err) {
      console.error(err);
      toast.error("Failed to add family member.");
    } finally {
      setAdding(false);
    }
  };

  const handleRename = async (id, newDisplayName) => {
    try {
      await setDoc(doc(db, "users", id), { displayName: newDisplayName }, { merge: true });
      setMembers((prev) => prev.map((m) => (m.id === id ? { ...m, displayName: newDisplayName } : m)));
      toast.success("Renamed.");
    } catch (err) {
      console.error(err);
      toast.error("Failed to rename.");
    }
  };

  const handleRemove = async () => {
    if (!removingMember) return;
    setRemoving(true);
    try {
      await deleteDoc(doc(db, "users", removingMember.id));
      setMembers((prev) => prev.filter((m) => m.id !== removingMember.id));
      toast.success(`Removed ${removingMember.displayName}`);
      setRemovingMember(null);
    } catch (err) {
      console.error(err);
      toast.error("Failed to remove family member.");
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 text-black dark:text-white p-6 rounded-xl shadow w-full space-y-4">
      <div className="flex items-center gap-2">
        <Users size={20} />
        <h2 className="text-lg font-bold">Family Members</h2>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Add family members to submit picks on their behalf — no separate account needed for them.
      </p>

      {loading ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
      ) : members.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">No family members yet.</p>
      ) : (
        <div className="space-y-2">
          {members.map((m) => (
            <div
              key={m.id}
              className="flex items-center justify-between border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2"
            >
              <span className="font-medium">{m.displayName}</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setRenamingMember(m)}
                  title="Rename"
                  className="p-1.5 rounded-md border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  <UserPen size={15} />
                </button>
                <button
                  onClick={() => setRemovingMember(m)}
                  title="Remove"
                  className="p-1.5 rounded-md border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 text-red-600 dark:text-red-400"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={handleAdd} className="flex gap-2">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Add a family member"
          maxLength={40}
          className="flex-1 border px-3 py-2 rounded dark:bg-gray-700 dark:border-gray-600"
        />
        <button
          type="submit"
          disabled={adding || !newName.trim()}
          className="flex items-center gap-1 px-3 py-2 bg-blue-600 text-white font-semibold rounded hover:bg-blue-700 disabled:opacity-50"
        >
          <Plus size={16} /> Add
        </button>
      </form>

      {renamingMember && (
        <RenameModal
          uid={renamingMember.id}
          currentName={renamingMember.displayName}
          title="Rename Family Member"
          onSave={handleRename}
          onClose={() => setRenamingMember(null)}
        />
      )}

      {removingMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-sm p-5 space-y-4">
            <h2 className="font-bold text-lg">Remove Family Member</h2>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Remove <span className="font-semibold">{removingMember.displayName}</span>? This cannot be undone.
              Past picks and results will remain visible under their name.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setRemovingMember(null)}
                className="flex-1 py-2.5 border border-gray-300 dark:border-gray-600 font-semibold rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={handleRemove}
                disabled={removing}
                className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg disabled:opacity-50"
              >
                {removing ? "Removing…" : "Remove"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

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
    <div className="min-h-screen flex items-center justify-center bg-gray-100 px-4 py-8 dark:bg-gray-900">
      <div className="w-full max-w-md space-y-4">
      <form
        onSubmit={handleSave}
        className="bg-white dark:bg-gray-800 text-black dark:text-white p-6 rounded-xl shadow w-full space-y-4"
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

      {!isAnon && user && <FamilyMembersCard ownerUid={user.uid} />}
      </div>
    </div>
  );
}
