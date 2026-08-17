import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/router";
import { auth, db } from "../../../../lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, setDoc, collection, query, where, getDocs } from "firebase/firestore";
import Image from "next/image";
import { Unlock, Info } from "lucide-react";
import { getScoreboard } from "../../../../lib/espnScoreboard";

export async function getServerSideProps(context) {
  const { year, week, season } = context.query;

  const typeMap = { pre: 1, reg: 2, post: 3 };
  const seasontype = typeMap[season] ?? 2; // default to regular if missing

  const { data } = await getScoreboard({ year, week, seasontype });

  const events = Array.isArray(data?.events) ? data.events : [];

  const matchups = events
    .map((event) => {
      const comp = event?.competitions?.[0] ?? {};
      const competitors = comp?.competitors || [];
      const homeComp = competitors.find((c) => c?.homeAway === "home") || competitors[0] || {};
      const awayComp = competitors.find((c) => c?.homeAway === "away") || competitors[1] || {};

      return {
        eventId: String(event?.id ?? ""),
        gameDate: event?.date ?? null,
        spread: comp?.odds?.[0]?.details || "No Spread Available",
        overUnder: comp?.odds?.[0]?.overUnder || "No O/U Available",
        homeTeam: {
          name: homeComp?.team?.shortDisplayName || "HOME",
          logo: homeComp?.team?.logo || "",
          id: homeComp?.team?.id || `home-${event?.id}`,
          record: homeComp?.records?.[0]?.summary || "0-0",
          isHome: true,
        },
        awayTeam: {
          name: awayComp?.team?.shortDisplayName || "AWAY",
          logo: awayComp?.team?.logo || "",
          id: awayComp?.team?.id || `away-${event?.id}`,
          record: awayComp?.records?.[0]?.summary || "0-0",
          isHome: false,
        },
      };
    })
    .sort((a, b) => new Date(a.gameDate) - new Date(b.gameDate));

  return {
    props: {
      year: String(year),
      week: String(week),
      season: String(season || "reg"),
      matchups,
    },
  };
}

export default function PicksPage({ year, week, season, matchups }) {
  const [user, setUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [picks, setPicks] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [hasUnlocked, setHasUnlocked] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [tieBreaker, setTieBreaker] = useState("");
  const [submittedAt, setSubmittedAt] = useState(null);
  const [lastEditedAt, setLastEditedAt] = useState(null); // NEW
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [autoSaveStatus, setAutoSaveStatus] = useState("idle"); // idle | saving | saved | error
  const hasHydrated = useRef(false);
  const autoSaveTimer = useRef(null);

  // Family Members: submitting picks on someone else's behalf from your
  // own login. null actingId = "Me"; otherwise a family member's doc id.
  const [familyMembers, setFamilyMembers] = useState([]);
  const [actingId, setActingId] = useState(null);

  // NEW: controls whether we are still before the earliest game’s kickoff
  const [isBeforeKickoff, setIsBeforeKickoff] = useState(true);

  const router = useRouter();

  // include season to avoid collisions (e.g., 2025-pre-W2 vs 2025-reg-W2)
  const todayKey = `${year}-${season}-W${week}`;
  const lastGame = matchups?.[matchups.length - 1] || null;

  // NEW: compute earliest kickoff from ESPN data and tick once per second
  useEffect(() => {
    const firstGameIso = matchups?.[0]?.gameDate || null;
    const firstMs = firstGameIso ? new Date(firstGameIso).getTime() : null;

    const tick = () => {
      if (!firstMs || Number.isNaN(firstMs)) {
        setIsBeforeKickoff(false);
      } else {
        setIsBeforeKickoff(Date.now() < firstMs);
      }
    };

    tick(); // initial
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [matchups]);

  // Preseason is a free-editing beta period — no kickoff deadline
  const isPreseason = season === "pre";
  const picksOpen = isBeforeKickoff || isPreseason;

  // Loads picks + profile for whichever identity is acting (yourself, or a
  // family member you manage) — id is a Firebase Auth uid for "Me", or a
  // family member's users/{profileId} doc id.
  const loadPicksFor = async (id) => {
    const weekRef = doc(db, "picks", id, "weeks", todayKey);
    const weekSnap = await getDoc(weekRef);

    const userRef = doc(db, "users", id);
    const userSnap = await getDoc(userRef);
    setUserProfile(userSnap.exists() ? userSnap.data() : null);

    if (weekSnap.exists()) {
      const pickData = weekSnap.data();
      setPicks(pickData);
      setTieBreaker(pickData.tieBreaker || "");
      setSubmitted(pickData.locked === true);
      setSubmittedAt(pickData.submittedAt || null);
      setLastEditedAt(pickData.lastEditedAt || pickData.submittedAt || null); // prefer lastEditedAt
    } else {
      setPicks({});
      setTieBreaker("");
      setSubmitted(false);
      setSubmittedAt(null);
      setLastEditedAt(null);
    }
  };

  useEffect(() => {
    hasHydrated.current = false;
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      setActingId(null); // reset to "Me" whenever the auth session changes
      if (u) {
        await loadPicksFor(u.uid);
      } else {
        setUserProfile(null);
        setPicks({});
        setSubmitted(false);
        setSubmittedAt(null);
        setLastEditedAt(null);
      }
      // Allow auto-save to run only after this initial load finishes,
      // so restoring existing picks doesn't immediately trigger a save.
      hasHydrated.current = true;
    });
    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayKey]);

  // Family members you manage — fetched once per signed-in owner, so the
  // "Picking as" selector only appears at all if you have any.
  useEffect(() => {
    if (!user?.uid) {
      setFamilyMembers([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const q = query(collection(db, "users"), where("managedBy", "==", user.uid));
      const snap = await getDocs(q);
      if (cancelled) return;
      setFamilyMembers(snap.docs.map((d) => ({ id: d.id, displayName: d.data().displayName || "" })));
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.uid]);

  const activeId = actingId || user?.uid || null;

  // Switching who you're picking for: cancel any pending auto-save so it
  // can't land on the wrong profile's doc, then load the new profile's data.
  const handleActingChange = async (newActingId) => {
    if (autoSaveTimer.current) {
      clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = null;
    }
    hasHydrated.current = false;
    setActingId(newActingId);
    const targetId = newActingId || user?.uid;
    if (targetId) await loadPicksFor(targetId);
    hasHydrated.current = true;
  };

  // Auto-save picks + tiebreaker as the user goes, so nothing is lost if
  // they get interrupted before hitting Submit. Final Submit still locks it.
  useEffect(() => {
    if (!hasHydrated.current || !activeId || submitted || !picksOpen) return;
    if (Object.keys(picks).length === 0 && !tieBreaker) return;

    setAutoSaveStatus("saving");
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(async () => {
      try {
        const ref = doc(db, "picks", activeId, "weeks", todayKey);
        const now = new Date().toISOString();
        await setDoc(
          ref,
          {
            ...picks,
            tieBreaker,
            displayName: userProfile?.displayName || "",
            weekKey: todayKey,
            lastEditedAt: now,
          },
          { merge: true }
        );
        setLastEditedAt(now);
        setAutoSaveStatus("saved");
      } catch (err) {
        console.error("Auto-save failed", err);
        setAutoSaveStatus("error");
      }
    }, 800);

    return () => clearTimeout(autoSaveTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picks, tieBreaker, activeId]);

  const handlePick = (eventId, teamName) => {
    if (submitted) return;
    setPicks((prev) => ({ ...prev, [eventId]: teamName }));
  };

  const handleSubmit = async () => {
    if (!activeId) return;

    const name = userProfile?.displayName || "";
    setSubmitError(null);

    try {
      const now = new Date().toISOString();
      const ref = doc(db, "picks", activeId, "weeks", todayKey);

      // Read existing to preserve original submittedAt
      const existingSnap = await getDoc(ref);
      const existing = existingSnap.exists() ? existingSnap.data() : null;
      const preservedSubmittedAt = existing?.submittedAt || now; // first submit sets both to now

      await setDoc(
        ref,
        {
          // keep only event picks from state, spread is fine but we'll override system fields
          ...picks,
          tieBreaker,
          displayName: name,
          locked: true,
          weekKey: todayKey,

          // leave submittedAt alone after first submit
          submittedAt: preservedSubmittedAt,

          // always update lastEditedAt
          lastEditedAt: now,
        },
        { merge: true }
      );

      setSubmitted(true);
      setSubmittedAt(preservedSubmittedAt);
      setLastEditedAt(now);
      setShowConfirmation(true);
    } catch (err) {
      console.error("Submission failed", err);
      setSubmitError(
        err.code === "permission-denied"
          ? "Picks are closed for this week — the first game has already started."
          : "Something went wrong submitting your picks. Please try again."
      );
    }
  };

  const toggleLock = () => {
    // safety guard – do not unlock after kickoff (except preseason)
    if (!picksOpen) return;
    setSubmitted(false);
    setHasUnlocked(true);
    // Do not delete timestamps from local state
  };

  const pickedGames = matchups.filter((game) => picks[game.eventId]);
  const isSubmitDisabled =
    submitted ||
    !picksOpen ||
    pickedGames.length !== matchups.length ||
    tieBreaker.trim() === "";

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 pb-32 bg-white dark:bg-gray-900 min-h-screen">
      <h1 className="text-4xl font-extrabold text-center mb-2 text-gray-900 dark:text-white tracking-tight">
        Week {week} Picks
      </h1>

      {!picksOpen && !submitted && (
        <div className="mb-4 text-center text-sm font-semibold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg py-2 px-3">
          Picks are closed for this week — the first game has already started.
        </div>
      )}

      {familyMembers.length > 0 && (
        <div className="mb-4 max-w-xs mx-auto">
          <label
            htmlFor="actingAs"
            className="block text-center text-sm font-medium text-gray-600 dark:text-gray-300 mb-1"
          >
            Picking as
          </label>
          <select
            id="actingAs"
            value={actingId || ""}
            onChange={(e) => handleActingChange(e.target.value || null)}
            className="w-full border px-3 py-2 rounded dark:bg-gray-700 dark:border-gray-600 text-center"
          >
            <option value="">Me</option>
            {familyMembers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
              </option>
            ))}
          </select>
        </div>
      )}

      {userProfile?.displayName && (
        <div className="mb-4 text-center text-lg text-gray-800 dark:text-gray-200 font-medium">
          {actingId ? "Submitting picks for" : "Welcome back"},&nbsp;
          <span className="font-bold text-gray-900 dark:text-white text-xl">
            {userProfile.displayName}
          </span>
          {!actingId && <> 👋</>}
        </div>
      )}

      {(submittedAt || lastEditedAt) && (
        <div className="mb-4 text-center text-xs text-gray-500 dark:text-gray-400 italic">
          {lastEditedAt && submittedAt && lastEditedAt !== submittedAt ? (
            <>Picks last updated on {new Date(lastEditedAt).toLocaleString()}</>
          ) : submittedAt ? (
            <>Picks submitted on {new Date(submittedAt).toLocaleString()}</>
          ) : (
            <>Picks last updated on {new Date(lastEditedAt).toLocaleString()}</>
          )}
        </div>
      )}

      {/* Hide Unlock button once the first game starts (except preseason) */}
      {submitted && picksOpen && (
        <div className="flex justify-center mb-4">
          <button
            onClick={toggleLock}
            className={`flex items-center gap-2 px-4 py-2 w-64 justify-center rounded-md text-sm font-medium transition border ${
              hasUnlocked
                ? "bg-blue-50 dark:bg-blue-900 text-blue-700 dark:text-blue-200 border-blue-400"
                : "bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-100 border-gray-400 hover:bg-gray-300 dark:hover:bg-gray-600"
            }`}
          >
            <Unlock size={16} />
            Unlock Picks
          </button>
        </div>
      )}

      <div className="flex justify-center mb-4">
        <button
          onClick={() => setShowDetails(!showDetails)}
          className={`flex items-center gap-2 px-4 py-2 w-64 justify-center rounded-md text-sm font-medium transition border ${
            showDetails
              ? "bg-blue-50 dark:bg-blue-900 text-blue-700 dark:text-blue-200 border-blue-400"
              : "bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-100 border-gray-400 hover:bg-gray-300 dark:hover:bg-gray-600"
          }`}
        >
          <Info size={16} />
          {showDetails ? "Hide Game Details" : "Show Game Details"}
        </button>
      </div>

      {hasUnlocked && (
        <div className="text-center text-xs text-orange-500 dark:text-orange-400 italic mb-4">
          Picks are unlocked. You can edit and resubmit.
        </div>
      )}

      <div className="space-y-6">
        {matchups.map((game) => (
          <div
            key={game.eventId}
            className="rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-3 bg-white dark:bg-gray-800"
          >
            <div className="text-sm font-semibold text-center text-blue-600 dark:text-blue-300 mb-2">
              {game.gameDate
                ? new Date(game.gameDate).toLocaleString("en-US", {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "numeric",
                  })
                : "TBD"}
            </div>

            {showDetails && (
              <div className="text-center text-xs text-gray-600 dark:text-gray-400 mb-2">
                <div>Spread: {game.spread}</div>
                <div>O/U: {game.overUnder}</div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              {[game.awayTeam, game.homeTeam].map((team) => {
                const selected = picks[game.eventId] === team.name;
                return (
                  <button
                    key={team.id}
                    onClick={() => handlePick(game.eventId, team.name)}
                    className={`flex flex-col items-center justify-center px-2 py-2 rounded-lg border transition text-center ${
                      selected
                        ? "border-blue-500 bg-blue-50 dark:bg-blue-900 ring-2 ring-blue-400"
                        : "border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700"
                    }`}
                    disabled={submitted}
                  >
                    {team.logo ? (
                      <Image
                        src={team.logo}
                        alt={team.name}
                        width={48}
                        height={48}
                        className="rounded"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded bg-gray-200 dark:bg-gray-700" />
                    )}
                    <div className="text-sm font-bold uppercase mt-1 text-gray-900 dark:text-white">
                      {team.name}
                    </div>
                    {showDetails && (
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        {team.record} ({team.isHome ? "Home" : "Away"})
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-10 max-w-md mx-auto">
        <label
          htmlFor="tieBreaker"
          className="block text-center font-medium text-gray-700 dark:text-gray-200 mb-2"
        >
          <div className="text-lg font-semibold">Tie Breaker</div>
          {lastGame ? (
            <div>
              Total Points in {lastGame.awayTeam.name} @ {lastGame.homeTeam.name}
            </div>
          ) : (
            <div>Total Points in Final Listed Game</div>
          )}
        </label>
        <input
          type="number"
          id="tieBreaker"
          value={tieBreaker}
          onChange={(e) => setTieBreaker(e.target.value)}
          className="w-full p-3 border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 text-black dark:text-white border-gray-300 dark:border-gray-600 text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          placeholder="Enter total combined score"
          disabled={submitted}
        />
        {!submitted && picksOpen && (
          <p className="mt-2 text-center text-xs text-gray-500 dark:text-gray-400">
            {autoSaveStatus === "saving"
              ? "Saving…"
              : autoSaveStatus === "saved"
              ? "✓ Your progress is saved"
              : autoSaveStatus === "error"
              ? "⚠ Couldn't save — check your connection"
              : "Your picks save automatically as you go"}
          </p>
        )}
      </div>

      <div className="mt-10 text-center">
        <button
          onClick={handleSubmit}
          disabled={isSubmitDisabled}
          className={`px-6 py-3 font-semibold text-white rounded-lg transition ${
            isSubmitDisabled ? "bg-gray-400 cursor-not-allowed" : "bg-green-600 hover:bg-green-700"
          }`}
        >
          {submitted ? "Picks Submitted" : "Submit Picks"}
        </button>
        {submitError && (
          <p className="mt-3 text-sm font-medium text-red-600 dark:text-red-400">{submitError}</p>
        )}
      </div>

      {showConfirmation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 dark:bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-900 rounded-xl p-6 shadow-xl max-w-sm w-full text-center">
            <div className="text-4xl mb-3">🎉</div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
              Your picks have been submitted!
            </h2>
            <p className="text-gray-600 dark:text-gray-300 mb-5">Good luck this week.</p>
            <button
              onClick={() => router.push("/dashboard")}
              className="px-5 py-2 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700"
            >
              Go to Dashboard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
