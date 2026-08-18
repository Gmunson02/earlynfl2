import { useCallback, useEffect, useMemo, useState } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import { auth, db, functions } from "../lib/firebase";
import { sendPasswordResetEmail } from "firebase/auth";
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  Timestamp,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import useIsAdmin from "../hooks/useIsAdmin";
import RenameModal from "../components/RenameModal";
import { CheckCircle2, Circle, Unlock, Pencil, UserPen, X, ChevronDown, ChevronRight, UserPlus, Mail, MessageSquare, Users, Home, Trash2 } from "lucide-react";

const SEASON_ID = "nfl-2026";
const SITE_URL = "https://www.earlynfl.com";
const INVITE_SUBJECT = "2026 Season of Early NFL Weekly Pick Em";
const INVITE_BODY = `It's time for the 2026 season of Early NFL Weekly Pick Em. To get started, simply head to ${SITE_URL} and create a new account.\n\nIf you have any questions, reach out to David directly at dtearly@gmail.com.\n\nSee you there!`;
const TYPE_MAP = { pre: 1, reg: 2, post: 3 };
const SYSTEM_FIELDS = ["tieBreaker", "displayName", "locked", "submittedAt", "lastEditedAt", "weekKey", "adminUnlockUntil"];

function tsToDate(x) {
  return x?.toDate ? x.toDate() : null;
}

// ---- Edit Picks modal ----
function EditPicksModal({ uid, displayName, week, onClose }) {
  const weekKey = `${week.seasonYear}-${week.seasonType}-W${week.value}`;
  const [matchups, setMatchups] = useState([]);
  const [picks, setPicks] = useState({});
  const [tieBreaker, setTieBreaker] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const seasontype = TYPE_MAP[week.seasonType] ?? 2;
      const [scoreRes, pickSnap] = await Promise.all([
        fetch(`/api/scoreboard?year=${week.seasonYear}&week=${week.value}&seasontype=${seasontype}`).then((r) => r.json()),
        getDoc(doc(db, "picks", uid, "weeks", weekKey)),
      ]);
      if (cancelled) return;

      const events = Array.isArray(scoreRes?.events) ? scoreRes.events : [];
      const built = events
        .map((event) => {
          const comp = event?.competitions?.[0] ?? {};
          const competitors = comp?.competitors || [];
          const home = competitors.find((c) => c?.homeAway === "home") || competitors[0] || {};
          const away = competitors.find((c) => c?.homeAway === "away") || competitors[1] || {};
          return {
            eventId: String(event?.id ?? ""),
            gameDate: event?.date ?? null,
            homeTeam: { name: home?.team?.shortDisplayName || "HOME", logo: home?.team?.logo || "" },
            awayTeam: { name: away?.team?.shortDisplayName || "AWAY", logo: away?.team?.logo || "" },
          };
        })
        .sort((a, b) => new Date(a.gameDate) - new Date(b.gameDate));
      setMatchups(built);

      if (pickSnap.exists()) {
        const data = pickSnap.data();
        setTieBreaker(String(data.tieBreaker ?? ""));
        const p = {};
        Object.entries(data).forEach(([k, v]) => {
          if (!SYSTEM_FIELDS.includes(k)) p[k] = v;
        });
        setPicks(p);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [uid, weekKey, week]);

  const handlePick = (eventId, teamName) => setPicks((prev) => ({ ...prev, [eventId]: teamName }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const existingSnap = await getDoc(doc(db, "picks", uid, "weeks", weekKey));
      const existing = existingSnap.exists() ? existingSnap.data() : null;
      const now = new Date().toISOString();
      await setDoc(
        doc(db, "picks", uid, "weeks", weekKey),
        {
          ...picks,
          tieBreaker,
          displayName,
          locked: true,
          weekKey,
          submittedAt: existing?.submittedAt || now,
          lastEditedAt: now,
        },
        { merge: true }
      );
      onClose(true);
    } catch (err) {
      console.error("Admin pick save failed:", err);
      alert("Save failed — see console.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto">
        <div className="sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-5 py-3 flex items-center justify-between">
          <h2 className="font-bold text-lg">Editing picks — {displayName || uid}</h2>
          <button onClick={() => onClose(false)} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        {loading ? (
          <p className="p-6 text-center text-gray-500">Loading matchups…</p>
        ) : (
          <div className="p-5 space-y-4">
            {matchups.map((game) => (
              <div key={game.eventId} className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                <div className="grid grid-cols-2 gap-2">
                  {[game.awayTeam, game.homeTeam].map((team) => {
                    const selected = picks[game.eventId] === team.name;
                    return (
                      <button
                        key={team.name}
                        onClick={() => handlePick(game.eventId, team.name)}
                        className={`px-2 py-2 rounded-lg border text-sm font-semibold ${
                          selected
                            ? "border-blue-500 bg-blue-50 dark:bg-blue-900 ring-2 ring-blue-400"
                            : "border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700"
                        }`}
                      >
                        {team.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            <div>
              <label className="block text-sm font-medium mb-1">Tiebreaker</label>
              <input
                type="number"
                value={tieBreaker}
                onChange={(e) => setTieBreaker(e.target.value)}
                className="w-full p-2 border rounded-lg dark:bg-gray-800 dark:border-gray-600"
              />
            </div>

            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full py-2.5 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save Picks"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Registered users modal (excludes guests and Family Member profiles) ----
function RegisteredUsersModal({ users, authInfo, onClose }) {
  const registered = useMemo(
    () =>
      users
        .filter((u) => !u.isGuest && !u.managedBy)
        .sort((a, b) => (a.displayName || "").localeCompare(b.displayName || "")),
    [users]
  );

  const formatDate = (iso) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-4xl max-h-[80vh] flex flex-col">
        <div className="border-b border-gray-200 dark:border-gray-700 px-5 py-3 flex items-center justify-between shrink-0">
          <h2 className="font-bold text-lg">Registered Users ({registered.length})</h2>
          <button onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="overflow-auto p-5">
          {registered.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">No registered users yet.</p>
          ) : (
            <table className="min-w-max w-full text-sm">
              <thead className="bg-zinc-700 text-white">
                <tr>
                  <th className="text-left px-3 py-2">Display Name</th>
                  <th className="text-left px-3 py-2">First Name</th>
                  <th className="text-left px-3 py-2">Last Name</th>
                  <th className="text-left px-3 py-2">Email</th>
                  <th className="text-left px-3 py-2">Date Registered</th>
                  <th className="text-left px-3 py-2">Last Login</th>
                </tr>
              </thead>
              <tbody>
                {registered.map((u, idx) => (
                  <tr
                    key={u.uid}
                    className={idx % 2 ? "bg-zinc-50 dark:bg-zinc-900/60" : "bg-white dark:bg-zinc-800/60"}
                  >
                    <td className="px-3 py-2 font-semibold whitespace-nowrap">{u.displayName || "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{u.firstName || "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{u.lastName || "—"}</td>
                    <td className="px-3 py-2 text-zinc-500 whitespace-nowrap">{u.email || "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{formatDate(u.createdAt)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {formatDate(authInfo?.[u.uid]?.lastSignInTime)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Manage User modal: edit first/last/display name, plus a password
// reset for accounts that actually have a password to reset (not guests,
// not Google-only sign-ins). ----
function ManageUserModal({ user, providers, onSave, onClose }) {
  const [firstName, setFirstName] = useState(user.firstName || "");
  const [lastName, setLastName] = useState(user.lastName || "");
  const [displayName, setDisplayName] = useState(user.displayName || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const [resetSending, setResetSending] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [resetError, setResetError] = useState(null);

  const canResetPassword = !user.isGuest && !user.managedBy && !!user.email && (providers || []).includes("password");

  const handleSave = async () => {
    const dn = displayName.trim();
    if (!dn) {
      setError("Display Name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(user.uid, {
        displayName: dn,
        ...(user.isGuest ? {} : { firstName: firstName.trim(), lastName: lastName.trim() }),
      });
      onClose();
    } catch (err) {
      console.error("Manage user save failed:", err);
      setError(err.message || "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  const handleResetPassword = async () => {
    setResetSending(true);
    setResetError(null);
    try {
      await sendPasswordResetEmail(auth, user.email);
      setResetSent(true);
    } catch (err) {
      console.error("Password reset send failed:", err);
      setResetError(err.message || "Failed to send reset email.");
    } finally {
      setResetSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-sm">
        <div className="border-b border-gray-200 dark:border-gray-700 px-5 py-3 flex items-center justify-between">
          <h2 className="font-bold text-lg">Manage User</h2>
          <button onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {!user.isGuest && (
            <>
              <div>
                <label className="block text-sm font-medium mb-1">First Name</label>
                <input
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="w-full p-2 border rounded-lg dark:bg-gray-800 dark:border-gray-600"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Last Name</label>
                <input
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="w-full p-2 border rounded-lg dark:bg-gray-800 dark:border-gray-600"
                />
              </div>
            </>
          )}
          <div>
            <label className="block text-sm font-medium mb-1">Display Name</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={40}
              className="w-full p-2 border rounded-lg dark:bg-gray-800 dark:border-gray-600"
            />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 border border-gray-300 dark:border-gray-600 font-semibold rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 py-2.5 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>

          {canResetPassword && (
            <div className="pt-3 border-t border-gray-200 dark:border-gray-700 space-y-2">
              <button
                onClick={handleResetPassword}
                disabled={resetSending || resetSent}
                className="w-full py-2.5 border border-amber-400 dark:border-amber-600 text-amber-700 dark:text-amber-400 font-semibold rounded-lg hover:bg-amber-50 dark:hover:bg-amber-900/20 disabled:opacity-50"
              >
                {resetSent ? "Reset Email Sent" : resetSending ? "Sending…" : "Send Password Reset Email"}
              </button>
              {resetError && <p className="text-sm text-red-500">{resetError}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Delete User modal: full cascade delete (Auth + profile + picks +
// ledger). Requires typing DELETE to confirm — this is irreversible. ----
function DeleteUserModal({ user, onConfirm, onClose }) {
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);
  const canConfirm = confirmText === "DELETE" && !deleting;

  const handleConfirm = async () => {
    if (!canConfirm) return;
    setDeleting(true);
    setError(null);
    try {
      await onConfirm(user.uid);
      onClose();
    } catch (err) {
      console.error("Delete user failed:", err);
      setError(err.message || "Failed to delete user.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md p-5 space-y-4">
        <h2 className="font-bold text-lg text-red-600 dark:text-red-400">Delete User</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          This permanently deletes{" "}
          <span className="font-semibold">{user.displayName || user.uid}</span>
          {user.email ? ` (${user.email})` : ""} — their sign-in, profile, every week of picks,
          and their ledger entry. This cannot be undone.
        </p>
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          Type <span className="font-mono font-bold">DELETE</span> to confirm.
        </p>
        <input
          type="text"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder="DELETE"
          className="w-full p-2.5 border rounded-lg dark:bg-gray-800 dark:border-gray-600 font-mono"
          autoFocus
        />
        {error && <p className="text-sm text-red-500">{error}</p>}
        <div className="flex gap-2 pt-1">
          <button
            onClick={onClose}
            disabled={deleting}
            className="flex-1 py-2.5 border border-gray-300 dark:border-gray-600 font-semibold rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg disabled:opacity-50"
          >
            {deleting ? "Deleting…" : "Delete Permanently"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Family Members modal: grouped by owner, admin can add/rename/remove
// a profile on anyone's behalf ----
function FamilyMembersModal({ users, onAdd, onRename, onRemove, onClose }) {
  const familyGroups = useMemo(() => {
    const owners = new Map();
    users.forEach((u) => {
      if (!u.managedBy) return;
      if (!owners.has(u.managedBy)) {
        const ownerDoc = users.find((o) => o.uid === u.managedBy);
        owners.set(u.managedBy, { owner: ownerDoc || { uid: u.managedBy, displayName: "(unknown)" }, members: [] });
      }
      owners.get(u.managedBy).members.push(u);
    });
    return [...owners.values()]
      .map((g) => ({
        ...g,
        members: [...g.members].sort((a, b) => (a.displayName || "").localeCompare(b.displayName || "")),
      }))
      .sort((a, b) => (a.owner.displayName || "").localeCompare(b.owner.displayName || ""));
  }, [users]);

  const realUsers = useMemo(
    () => [...users].filter((u) => !u.managedBy).sort((a, b) => (a.displayName || "").localeCompare(b.displayName || "")),
    [users]
  );

  const [renamingMember, setRenamingMember] = useState(null); // {uid, displayName} | null
  const [removingMember, setRemovingMember] = useState(null); // {uid, displayName} | null
  const [removing, setRemoving] = useState(false);
  const [addOwnerUid, setAddOwnerUid] = useState("");
  const [newMemberName, setNewMemberName] = useState("");
  const [adding, setAdding] = useState(false);

  const handleAdd = async () => {
    const trimmed = newMemberName.trim();
    if (!trimmed || !addOwnerUid) return;
    setAdding(true);
    try {
      await onAdd(addOwnerUid, trimmed);
      setNewMemberName("");
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async () => {
    if (!removingMember) return;
    setRemoving(true);
    try {
      await onRemove(removingMember.uid);
      setRemovingMember(null);
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="border-b border-gray-200 dark:border-gray-700 px-5 py-3 flex items-center justify-between shrink-0">
          <h2 className="font-bold text-lg">Family Members</h2>
          <button onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="overflow-y-auto p-5 space-y-5">
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-2">
            <div className="text-sm font-semibold">Add a family member</div>
            <div className="flex flex-col sm:flex-row gap-2">
              <select
                value={addOwnerUid}
                onChange={(e) => setAddOwnerUid(e.target.value)}
                className="flex-1 p-2 border rounded-lg dark:bg-gray-800 dark:border-gray-600"
              >
                <option value="">Choose owner…</option>
                {realUsers.map((u) => (
                  <option key={u.uid} value={u.uid}>
                    {u.displayName || u.uid}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={newMemberName}
                onChange={(e) => setNewMemberName(e.target.value)}
                placeholder="Family member's name"
                maxLength={40}
                className="flex-1 p-2 border rounded-lg dark:bg-gray-800 dark:border-gray-600"
              />
              <button
                onClick={handleAdd}
                disabled={adding || !addOwnerUid || !newMemberName.trim()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg disabled:opacity-50 whitespace-nowrap"
              >
                {adding ? "Adding…" : "Add"}
              </button>
            </div>
          </div>

          {familyGroups.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">No family members yet.</p>
          ) : (
            familyGroups.map((group) => (
              <div
                key={group.owner.uid}
                className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden"
              >
                <div className="bg-zinc-100 dark:bg-zinc-800 px-3 py-2 text-sm font-semibold">
                  {group.owner.displayName || group.owner.uid}'s Family
                  {group.owner.email && (
                    <span className="ml-2 font-normal text-zinc-500 dark:text-zinc-400">
                      ({group.owner.email})
                    </span>
                  )}
                </div>
                <div className="divide-y divide-gray-200 dark:divide-gray-700">
                  {group.members.map((m) => (
                    <div key={m.uid} className="flex items-center justify-between px-3 py-2">
                      <span>{m.displayName || "—"}</span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setRenamingMember(m)}
                          title="Rename"
                          className="p-1.5 rounded-md border border-zinc-300 dark:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                        >
                          <UserPen size={15} />
                        </button>
                        <button
                          onClick={() => setRemovingMember(m)}
                          title="Remove"
                          className="p-1.5 rounded-md border border-zinc-300 dark:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-700 text-red-600 dark:text-red-400"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {renamingMember && (
        <RenameModal
          uid={renamingMember.uid}
          currentName={renamingMember.displayName}
          title="Rename Family Member"
          onSave={onRename}
          onClose={() => setRenamingMember(null)}
        />
      )}

      {removingMember && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
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

// ---- Invite new user modal ----
function InviteUserModal({ onClose }) {
  const mailtoHref = `mailto:?subject=${encodeURIComponent(INVITE_SUBJECT)}&body=${encodeURIComponent(INVITE_BODY)}`;

  // iOS Messages expects "sms:&body=...", most Android browsers expect "sms:?body=..."
  const isIOS = typeof navigator !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent);
  const smsHref = `sms:${isIOS ? "&" : "?"}body=${encodeURIComponent(INVITE_BODY)}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-sm">
        <div className="border-b border-gray-200 dark:border-gray-700 px-5 py-3 flex items-center justify-between">
          <h2 className="font-bold text-lg">Invite New User</h2>
          <button onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Message preview</label>
            <p className="text-sm text-gray-500 dark:text-gray-400 whitespace-pre-wrap border border-gray-200 dark:border-gray-700 rounded-lg p-3">
              {INVITE_BODY}
            </p>
          </div>

          <p className="text-xs text-gray-500 dark:text-gray-400">
            Choose how to send it — you'll pick the recipient and app on the next screen.
          </p>

          <div className="flex flex-col gap-2">
            <a
              href={mailtoHref}
              onClick={onClose}
              className="flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg"
            >
              <Mail size={18} /> Invite via Email
            </a>
            <a
              href={smsHref}
              onClick={onClose}
              className="flex items-center justify-center gap-2 py-2.5 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg"
            >
              <MessageSquare size={18} /> Invite via Text
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- Editable ledger cell ----
function EditableCell({ value, onSave, type = "text", width = "w-24" }) {
  const [local, setLocal] = useState(value ?? "");
  useEffect(() => setLocal(value ?? ""), [value]);

  return (
    <input
      type={type}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        if (local !== (value ?? "")) onSave(local);
      }}
      className={`${width} px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-800`}
    />
  );
}

// ---- Editable whole-dollar currency cell — "$" prefix, digits only, no
// decimal entry, no native number-input spinner chevrons. Shows a ".00"
// suffix when not focused (purely cosmetic); editing works on raw digits
// so typing isn't fighting a fixed decimal tail. ----
function CurrencyCell({ value, onSave, width = "w-24" }) {
  const toDigits = (v) => {
    const s = String(v ?? "");
    const neg = s.trim().startsWith("-");
    const digits = s.replace(/[^0-9]/g, "");
    return (neg && digits ? "-" : "") + digits;
  };

  const [local, setLocal] = useState(toDigits(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setLocal(toDigits(value));
  }, [value, focused]);

  const shown = local === "" || local === "-" ? "0" : local;
  const displayValue = focused ? local : `${shown}.00`;

  return (
    <div className={`${width} relative`}>
      <span className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-sm text-gray-500 dark:text-gray-400">
        $
      </span>
      <input
        type="text"
        inputMode="numeric"
        value={displayValue}
        onFocus={() => setFocused(true)}
        onChange={(e) => setLocal(toDigits(e.target.value))}
        onBlur={() => {
          setFocused(false);
          const num = local === "" || local === "-" ? 0 : Number(local);
          if (num !== Number(value ?? 0)) onSave(num);
        }}
        className="w-full pl-5 pr-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-800"
      />
    </div>
  );
}

export default function AdminPage() {
  const router = useRouter();
  const adminStatus = useIsAdmin();

  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState([]);
  const [ledger, setLedger] = useState({});
  const [authInfo, setAuthInfo] = useState({}); // uid -> { lastSignInTime, creationTime, providers }
  const [weeksList, setWeeksList] = useState([]);
  const [selectedWeekId, setSelectedWeekId] = useState(null);
  const [submittedUids, setSubmittedUids] = useState(new Set());
  const [editingUser, setEditingUser] = useState(null);
  const [managingUser, setManagingUser] = useState(null);
  const [deletingUser, setDeletingUser] = useState(null);
  const [expandedUids, setExpandedUids] = useState(new Set());
  const [invitingUser, setInvitingUser] = useState(false);
  const [showRegisteredUsers, setShowRegisteredUsers] = useState(false);
  const [showFamilyMembers, setShowFamilyMembers] = useState(false);

  const sortedUsers = useMemo(
    () => [...users].sort((a, b) => (a.displayName || "").localeCompare(b.displayName || "")),
    [users]
  );

  const toggleExpanded = useCallback((uid) => {
    setExpandedUids((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  }, []);

  useEffect(() => {
    if (adminStatus === "not-admin") router.replace("/dashboard");
  }, [adminStatus, router]);

  useEffect(() => {
    if (adminStatus !== "admin") return;
    const load = async () => {
      setLoading(true);
      const [usersSnap, ledgerSnap, weeksSnap, authInfoResult] = await Promise.all([
        getDocs(collection(db, "users")),
        getDocs(collection(db, "admin_ledger")),
        getDocs(query(collection(db, "schedules", SEASON_ID, "weeks"), orderBy("order", "asc"))),
        httpsCallable(functions, "adminListAuthUsers")().catch((err) => {
          console.error("adminListAuthUsers failed:", err);
          return { data: { users: [] } };
        }),
      ]);

      const usersList = usersSnap.docs.map((d) => ({ uid: d.id, ...d.data() }));
      usersList.sort((a, b) => (a.displayName || "").localeCompare(b.displayName || ""));
      setUsers(usersList);

      const ledgerMap = {};
      ledgerSnap.forEach((d) => (ledgerMap[d.id] = d.data()));
      setLedger(ledgerMap);

      const authInfoMap = {};
      (authInfoResult?.data?.users || []).forEach((u) => (authInfoMap[u.uid] = u));
      setAuthInfo(authInfoMap);

      const weeks = weeksSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setWeeksList(weeks);

      // Same rule as useScheduleWeek: default to the earliest week that
      // doesn't have a weekly_results doc yet, not the week whose kickoff
      // window happens to contain "now" (that left the picker stuck on a
      // just-finished week for days).
      const seasonYear = weeks[0]?.seasonYear;
      let computedIds = new Set();
      if (seasonYear != null) {
        const resultsSnap = await getDocs(
          query(collection(db, "weekly_results"), where("year", "==", seasonYear))
        );
        computedIds = new Set(resultsSnap.docs.map((d) => d.id));
      }
      const weekDocId = (w) => `${w.seasonYear}-${w.seasonType}-W${w.value}`;
      const activeIdx = weeks.findIndex((w) => !computedIds.has(weekDocId(w)));
      setSelectedWeekId(weeks[activeIdx]?.id || weeks[weeks.length - 1]?.id || null);

      setLoading(false);
    };
    load();
  }, [adminStatus]);

  const selectedWeek = useMemo(() => weeksList.find((w) => w.id === selectedWeekId) || null, [weeksList, selectedWeekId]);
  const weekKey = selectedWeek ? `${selectedWeek.seasonYear}-${selectedWeek.seasonType}-W${selectedWeek.value}` : null;

  useEffect(() => {
    if (!weekKey) return;
    (async () => {
      const snap = await getDocs(query(collectionGroup(db, "weeks"), where("weekKey", "==", weekKey)));
      const locked = new Set();
      snap.forEach((d) => {
        if (d.data()?.locked === true) locked.add(d.ref.parent.parent.id);
      });
      setSubmittedUids(locked);
    })();
  }, [weekKey]);

  const kickoff = useMemo(() => tsToDate(selectedWeek?.firstGame), [selectedWeek]);
  const hoursUntilKickoff = kickoff ? (kickoff.getTime() - Date.now()) / 3_600_000 : null;
  const showMissingList = hoursUntilKickoff != null && hoursUntilKickoff <= 24;

  const missingUsers = useMemo(
    () => users.filter((u) => !submittedUids.has(u.uid)),
    [users, submittedUids]
  );

  const saveLedgerField = useCallback(async (uid, field, value) => {
    setLedger((prev) => ({ ...prev, [uid]: { ...prev[uid], [field]: value } }));
    try {
      await setDoc(doc(db, "admin_ledger", uid), { [field]: value }, { merge: true });
    } catch (err) {
      console.error("Ledger save failed:", err);
    }
  }, []);

  const saveDisplayName = useCallback(async (uid, value) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setUsers((prev) => prev.map((u) => (u.uid === uid ? { ...u, displayName: trimmed } : u)));
    try {
      await setDoc(doc(db, "users", uid), { displayName: trimmed }, { merge: true });
    } catch (err) {
      console.error("Display name save failed:", err);
      alert("Failed to update display name — see console.");
    }
  }, []);

  const saveUserFields = useCallback(async (uid, fields) => {
    await setDoc(doc(db, "users", uid), fields, { merge: true });
    setUsers((prev) => prev.map((u) => (u.uid === uid ? { ...u, ...fields } : u)));
  }, []);

  const addFamilyMember = useCallback(async (ownerUid, displayName) => {
    try {
      const ref = doc(collection(db, "users"));
      await setDoc(ref, { displayName, managedBy: ownerUid, isGuest: true, theme: "light" });
      setUsers((prev) => [...prev, { uid: ref.id, displayName, managedBy: ownerUid, isGuest: true, theme: "light" }]);
    } catch (err) {
      console.error("Add family member failed:", err);
      alert("Failed to add family member — see console.");
    }
  }, []);

  const removeFamilyMember = useCallback(async (uid) => {
    try {
      await deleteDoc(doc(db, "users", uid));
      setUsers((prev) => prev.filter((u) => u.uid !== uid));
    } catch (err) {
      console.error("Remove family member failed:", err);
      alert("Failed to remove family member — see console.");
    }
  }, []);

  const deleteUser = useCallback(async (uid) => {
    const call = httpsCallable(functions, "adminDeleteUser");
    await call({ uid });
    setUsers((prev) => prev.filter((u) => u.uid !== uid));
  }, []);

  const unlockUser = useCallback(
    async (uid, minutes = 30) => {
      if (!weekKey) return;
      const until = Timestamp.fromMillis(Date.now() + minutes * 60000);
      try {
        await setDoc(doc(db, "picks", uid, "weeks", weekKey), { adminUnlockUntil: until }, { merge: true });
        alert(`Unlocked picks for this user for the next ${minutes} minutes.`);
      } catch (err) {
        console.error("Unlock failed:", err);
        alert("Unlock failed — see console.");
      }
    },
    [weekKey]
  );

  if (adminStatus === "checking" || adminStatus === "not-admin") return null;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-900 text-zinc-900 dark:text-white px-4 py-6 pb-32">
      <Head>
        <title>Admin | EarlyNFL</title>
      </Head>

      <div className="max-w-[1600px] mx-auto space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl font-extrabold">Admin</h1>

          <div className="w-full sm:w-auto flex flex-wrap items-center gap-3">
            <button
              onClick={() => setShowRegisteredUsers(true)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-700 text-sm font-semibold"
            >
              <Users size={16} /> See Registered Users
            </button>

            <button
              onClick={() => setShowFamilyMembers(true)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-700 text-sm font-semibold"
            >
              <Home size={16} /> Family Members
            </button>

            {/* Not used this season.
            <button
              onClick={() => setInvitingUser(true)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold"
            >
              <UserPlus size={16} /> Invite New User
            </button>
            */}

            {weeksList.length > 0 && (
              <select
                value={selectedWeekId || ""}
                onChange={(e) => setSelectedWeekId(e.target.value)}
                className="w-full sm:w-auto px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 dark:bg-zinc-800 text-sm"
              >
                {weeksList.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.label || w.id}
                  </option>
                ))}
              </select>
            )}
          </div>
        </header>

        {!loading && selectedWeek && (
          <div className="rounded-xl bg-indigo-50 dark:bg-indigo-950 border border-indigo-200 dark:border-indigo-800 px-4 py-3">
            <div className="font-bold text-indigo-900 dark:text-indigo-100">
              {submittedUids.size} of {users.length} users have submitted picks for {selectedWeek.label || weekKey}
            </div>
            <div className="mt-2 h-2 w-full rounded-full bg-indigo-200 dark:bg-indigo-900 overflow-hidden">
              <div
                className="h-full bg-indigo-600 dark:bg-indigo-400 transition-all"
                style={{ width: users.length ? `${(submittedUids.size / users.length) * 100}%` : "0%" }}
              />
            </div>

            {showMissingList && missingUsers.length > 0 && (
              <div className="mt-3 pt-3 border-t border-indigo-200 dark:border-indigo-800 text-sm text-indigo-900 dark:text-indigo-100">
                <span className="font-bold">
                  {hoursUntilKickoff > 0
                    ? `Kickoff in ${hoursUntilKickoff.toFixed(1)}h — `
                    : "Kickoff has passed — "}
                  Still need picks from:
                </span>{" "}
                {missingUsers.map((u) => u.displayName || u.uid).join(", ")}
              </div>
            )}
          </div>
        )}

        {loading ? (
          <p className="text-zinc-500">Loading…</p>
        ) : (
          <div className="hidden sm:block overflow-x-auto bg-white dark:bg-zinc-800/70 rounded-xl border border-zinc-200 dark:border-zinc-700">
            <table className="min-w-max w-full text-sm">
              <thead className="bg-zinc-700 text-white">
                <tr>
                  <th className="text-left px-3 py-2">Display Name</th>
                  <th className="text-left px-3 py-2">Email</th>
                  <th className="text-left px-3 py-2">Full Name</th>
                  <th className="text-right px-3 py-2">Starting Balance</th>
                  <th className="text-right px-3 py-2" title="$1/week × 18 weeks = $18 for a full season">
                    Dues Owed
                  </th>
                  <th className="text-right px-3 py-2">2026 Winnings</th>
                  <th className="text-right px-3 py-2">Current Balance</th>
                  <th className="text-center px-3 py-2">Submitted</th>
                  <th className="text-center px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedUsers.map((u, idx) => {
                  const l = ledger[u.uid] || {};
                  const submitted = submittedUids.has(u.uid);
                  const startingBalance = Number(l.startingBalance) || 0;
                  const duesOwed = l.duesOwed != null ? Number(l.duesOwed) : 18; // default for a user with no ledger entry yet
                  const winnings = Number(l.winnings) || 0;
                  const currentBalance = startingBalance - duesOwed + winnings;
                  return (
                    <tr key={u.uid} className={idx % 2 ? "bg-zinc-50 dark:bg-zinc-900/60" : "bg-white dark:bg-zinc-800/60"}>
                      <td className="px-3 py-2 font-semibold whitespace-nowrap">
                        {u.displayName || "—"}
                        {u.managedBy ? (
                          <span className="ml-2 text-[10px] uppercase tracking-wide text-purple-600 dark:text-purple-400 font-bold">
                            family
                          </span>
                        ) : (
                          u.isGuest && (
                            <span className="ml-2 text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400 font-bold">
                              guest
                            </span>
                          )
                        )}
                      </td>
                      <td className="px-3 py-2 text-zinc-500 whitespace-nowrap">{u.email || "—"}</td>
                      <td className="px-3 py-2 text-zinc-500 whitespace-nowrap">
                        {[u.firstName, u.lastName].filter(Boolean).join(" ") || "—"}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <CurrencyCell
                          value={startingBalance}
                          onSave={(v) => saveLedgerField(u.uid, "startingBalance", v)}
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <CurrencyCell
                          value={duesOwed}
                          onSave={(v) => saveLedgerField(u.uid, "duesOwed", v)}
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <CurrencyCell
                          value={winnings}
                          onSave={(v) => saveLedgerField(u.uid, "winnings", v)}
                        />
                      </td>
                      <td
                        className={`px-3 py-2 text-right font-bold ${
                          currentBalance > 0 ? "text-emerald-600 dark:text-emerald-400" : currentBalance < 0 ? "text-red-600 dark:text-red-400" : ""
                        }`}
                      >
                        ${currentBalance.toFixed(2)}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {submitted ? (
                          <CheckCircle2 className="inline text-emerald-500" size={18} />
                        ) : (
                          <Circle className="inline text-zinc-300 dark:text-zinc-600" size={18} />
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => unlockUser(u.uid, 30)}
                            title="Unlock picks for 30 minutes"
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-zinc-300 dark:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-700 text-sm whitespace-nowrap"
                          >
                            <Unlock size={15} /> Unlock Picks
                          </button>
                          <button
                            onClick={() => setEditingUser(u)}
                            title="Edit this user's picks"
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-zinc-300 dark:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-700 text-sm whitespace-nowrap disabled:opacity-50"
                            disabled={!selectedWeek}
                          >
                            <Pencil size={15} /> Edit Picks
                          </button>
                          <button
                            onClick={() => setManagingUser(u)}
                            title="Manage this user's name and password"
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-zinc-300 dark:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-700 text-sm whitespace-nowrap"
                          >
                            <UserPen size={15} /> Manage User
                          </button>
                          <button
                            onClick={() => setDeletingUser(u)}
                            title="Permanently delete this user"
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 text-sm whitespace-nowrap"
                          >
                            <Trash2 size={15} /> Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!loading && (
          <div className="sm:hidden flex flex-col gap-2">
            {sortedUsers.map((u) => {
              const l = ledger[u.uid] || {};
              const submitted = submittedUids.has(u.uid);
              const startingBalance = Number(l.startingBalance) || 0;
              const duesOwed = l.duesOwed != null ? Number(l.duesOwed) : 18; // default for a user with no ledger entry yet
              const winnings = Number(l.winnings) || 0;
              const currentBalance = startingBalance - duesOwed + winnings;
              const isOpen = expandedUids.has(u.uid);

              return (
                <div
                  key={u.uid}
                  className="bg-white dark:bg-zinc-800/70 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden"
                >
                  <button
                    onClick={() => toggleExpanded(u.uid)}
                    className="w-full flex items-center justify-between px-4 py-3"
                  >
                    <span className="flex items-center gap-2 font-semibold">
                      {isOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                      {u.displayName || "—"}
                      {u.managedBy ? (
                        <span className="text-[10px] uppercase tracking-wide text-purple-600 dark:text-purple-400 font-bold">
                          family
                        </span>
                      ) : (
                        u.isGuest && (
                          <span className="text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400 font-bold">
                            guest
                          </span>
                        )
                      )}
                    </span>
                    {submitted ? (
                      <CheckCircle2 className="text-emerald-500" size={18} />
                    ) : (
                      <Circle className="text-zinc-300 dark:text-zinc-600" size={18} />
                    )}
                  </button>

                  {isOpen && (
                    <div className="px-4 pb-4 space-y-3 border-t border-zinc-200 dark:border-zinc-700 pt-3">
                      <div className="text-sm text-zinc-500 dark:text-zinc-400">{u.email || "—"}</div>

                      <div>
                        <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">
                          Full Name
                        </label>
                        <div className="text-sm text-zinc-500 dark:text-zinc-400">
                          {[u.firstName, u.lastName].filter(Boolean).join(" ") || "—"}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">
                            Starting Balance
                          </label>
                          <CurrencyCell
                            value={startingBalance}
                            width="w-full"
                            onSave={(v) => saveLedgerField(u.uid, "startingBalance", v)}
                          />
                        </div>
                        <div>
                          <label
                            className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1"
                            title="$1/week × 18 weeks = $18 for a full season"
                          >
                            Dues Owed
                          </label>
                          <CurrencyCell
                            value={duesOwed}
                            width="w-full"
                            onSave={(v) => saveLedgerField(u.uid, "duesOwed", v)}
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">
                            2026 Winnings
                          </label>
                          <CurrencyCell
                            value={winnings}
                            width="w-full"
                            onSave={(v) => saveLedgerField(u.uid, "winnings", v)}
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">
                            Current Balance
                          </label>
                          <div
                            className={`px-2 py-1.5 text-sm font-bold rounded border border-transparent ${
                              currentBalance > 0
                                ? "text-emerald-600 dark:text-emerald-400"
                                : currentBalance < 0
                                ? "text-red-600 dark:text-red-400"
                                : ""
                            }`}
                          >
                            ${currentBalance.toFixed(2)}
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col gap-2 pt-1">
                        <button
                          onClick={() => unlockUser(u.uid, 30)}
                          className="flex items-center justify-center gap-1.5 py-2.5 rounded-lg border border-zinc-300 dark:border-zinc-600 text-sm font-semibold hover:bg-zinc-100 dark:hover:bg-zinc-700"
                        >
                          <Unlock size={15} /> Unlock Picks
                        </button>
                        <button
                          onClick={() => setEditingUser(u)}
                          disabled={!selectedWeek}
                          className="flex items-center justify-center gap-1.5 py-2.5 rounded-lg border border-zinc-300 dark:border-zinc-600 text-sm font-semibold hover:bg-zinc-100 dark:hover:bg-zinc-700 disabled:opacity-50"
                        >
                          <Pencil size={15} /> Edit Picks
                        </button>
                        <button
                          onClick={() => setManagingUser(u)}
                          className="flex items-center justify-center gap-1.5 py-2.5 rounded-lg border border-zinc-300 dark:border-zinc-600 text-sm font-semibold hover:bg-zinc-100 dark:hover:bg-zinc-700"
                        >
                          <UserPen size={15} /> Manage User
                        </button>
                        <button
                          onClick={() => setDeletingUser(u)}
                          className="flex items-center justify-center gap-1.5 py-2.5 rounded-lg border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 text-sm font-semibold hover:bg-red-50 dark:hover:bg-red-900/20"
                        >
                          <Trash2 size={15} /> Delete
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {editingUser && selectedWeek && (
        <EditPicksModal
          uid={editingUser.uid}
          displayName={editingUser.displayName}
          week={selectedWeek}
          onClose={() => setEditingUser(null)}
        />
      )}

      {managingUser && (
        <ManageUserModal
          user={managingUser}
          providers={authInfo[managingUser.uid]?.providers}
          onSave={saveUserFields}
          onClose={() => setManagingUser(null)}
        />
      )}

      {deletingUser && (
        <DeleteUserModal
          user={deletingUser}
          onConfirm={deleteUser}
          onClose={() => setDeletingUser(null)}
        />
      )}

      {invitingUser && <InviteUserModal onClose={() => setInvitingUser(false)} />}

      {showRegisteredUsers && (
        <RegisteredUsersModal users={users} authInfo={authInfo} onClose={() => setShowRegisteredUsers(false)} />
      )}

      {showFamilyMembers && (
        <FamilyMembersModal
          users={users}
          onAdd={addFamilyMember}
          onRename={saveDisplayName}
          onRemove={removeFamilyMember}
          onClose={() => setShowFamilyMembers(false)}
        />
      )}
    </div>
  );
}
