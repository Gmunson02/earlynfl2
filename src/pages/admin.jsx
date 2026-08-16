import { useCallback, useEffect, useMemo, useState } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import { db } from "../lib/firebase";
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  setDoc,
  query,
  where,
  orderBy,
  Timestamp,
} from "firebase/firestore";
import useIsAdmin from "../hooks/useIsAdmin";
import { CheckCircle2, Circle, Unlock, Pencil, X } from "lucide-react";

const SEASON_ID = "nfl-2026";
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

export default function AdminPage() {
  const router = useRouter();
  const adminStatus = useIsAdmin();

  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState([]);
  const [ledger, setLedger] = useState({});
  const [weeksList, setWeeksList] = useState([]);
  const [selectedWeekId, setSelectedWeekId] = useState(null);
  const [submittedUids, setSubmittedUids] = useState(new Set());
  const [editingUser, setEditingUser] = useState(null);

  useEffect(() => {
    if (adminStatus === "not-admin") router.replace("/dashboard");
  }, [adminStatus, router]);

  useEffect(() => {
    if (adminStatus !== "admin") return;
    const load = async () => {
      setLoading(true);
      const [usersSnap, ledgerSnap, weeksSnap] = await Promise.all([
        getDocs(collection(db, "users")),
        getDocs(collection(db, "admin_ledger")),
        getDocs(query(collection(db, "schedules", SEASON_ID, "weeks"), orderBy("order", "asc"))),
      ]);

      const usersList = usersSnap.docs.map((d) => ({ uid: d.id, ...d.data() }));
      usersList.sort((a, b) => (a.displayName || "").localeCompare(b.displayName || ""));
      setUsers(usersList);

      const ledgerMap = {};
      ledgerSnap.forEach((d) => (ledgerMap[d.id] = d.data()));
      setLedger(ledgerMap);

      const weeks = weeksSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setWeeksList(weeks);

      const now = new Date();
      const activeIdx = weeks.findIndex((w) => {
        const s = tsToDate(w.start),
          e = tsToDate(w.end);
        return s && e && s <= now && now < e;
      });
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

      <div className="max-w-6xl mx-auto space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl font-extrabold">Admin</h1>

          {weeksList.length > 0 && (
            <select
              value={selectedWeekId || ""}
              onChange={(e) => setSelectedWeekId(e.target.value)}
              className="px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 dark:bg-zinc-800 text-sm"
            >
              {weeksList.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.label || w.id}
                </option>
              ))}
            </select>
          )}
        </header>

        {loading ? (
          <p className="text-zinc-500">Loading…</p>
        ) : (
          <div className="overflow-x-auto bg-white dark:bg-zinc-800/70 rounded-xl border border-zinc-200 dark:border-zinc-700">
            <table className="min-w-max w-full text-sm">
              <thead className="bg-zinc-700 text-white">
                <tr>
                  <th className="text-left px-3 py-2">User Name</th>
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
                {users.map((u, idx) => {
                  const l = ledger[u.uid] || {};
                  const submitted = submittedUids.has(u.uid);
                  const startingBalance = Number(l.startingBalance) || 0;
                  const duesOwed = Number(l.duesOwed) || 0;
                  const winnings = Number(l.winnings) || 0;
                  const currentBalance = startingBalance - duesOwed + winnings;
                  return (
                    <tr key={u.uid} className={idx % 2 ? "bg-zinc-50 dark:bg-zinc-900/60" : "bg-white dark:bg-zinc-800/60"}>
                      <td className="px-3 py-2 font-semibold whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <EditableCell
                            value={u.displayName}
                            width="w-32"
                            onSave={(v) => saveDisplayName(u.uid, v)}
                          />
                          {u.isGuest && (
                            <span className="text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400 font-bold">
                              guest
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-zinc-500 whitespace-nowrap">{u.email || "—"}</td>
                      <td className="px-3 py-2">
                        <EditableCell
                          value={l.fullName}
                          width="w-36"
                          onSave={(v) => saveLedgerField(u.uid, "fullName", v)}
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <EditableCell
                          type="number"
                          value={l.startingBalance}
                          onSave={(v) => saveLedgerField(u.uid, "startingBalance", Number(v) || 0)}
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <EditableCell
                          type="number"
                          value={l.duesOwed}
                          onSave={(v) => saveLedgerField(u.uid, "duesOwed", Number(v) || 0)}
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <EditableCell
                          type="number"
                          value={l.winnings}
                          onSave={(v) => saveLedgerField(u.uid, "winnings", Number(v) || 0)}
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
                            className="p-1.5 rounded-md border border-zinc-300 dark:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                          >
                            <Unlock size={15} />
                          </button>
                          <button
                            onClick={() => setEditingUser(u)}
                            title="Edit this user's picks"
                            className="p-1.5 rounded-md border border-zinc-300 dark:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                            disabled={!selectedWeek}
                          >
                            <Pencil size={15} />
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
      </div>

      {editingUser && selectedWeek && (
        <EditPicksModal
          uid={editingUser.uid}
          displayName={editingUser.displayName}
          week={selectedWeek}
          onClose={() => setEditingUser(null)}
        />
      )}
    </div>
  );
}
