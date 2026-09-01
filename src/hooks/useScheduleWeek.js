// hooks/useScheduleWeek.js
import { useEffect, useState } from "react";
import { db } from "../lib/firebase";
import { collection, getDocs, orderBy, query, where } from "firebase/firestore";

// Firestore Timestamp helper (works for web Timestamp or admin {seconds,...})
function tsToDate(x) {
  if (!x) return null;
  if (typeof x.toDate === "function") return x.toDate();
  if (typeof x.seconds === "number") return new Date(x.seconds * 1000);
  return x instanceof Date ? x : null;
}

/**
 * Reads schedules/{seasonId}/weeks ordered by 'order'.
 * "Current week" = the earliest week that doesn't yet have a weekly_results
 * doc (i.e. hasn't been finalized by the Tuesday 2am compute job), else the
 * last week if everything's been computed.
 * Returns ESPN week `value` (string) for routes, plus helpful timing fields.
 * This is the single source of truth for "what week is it" across the app —
 * anything gating picks by kickoff time should use this, not a live ESPN call.
 */
export default function useScheduleWeek(seasonId = "nfl-2026") {
  const [state, setState] = useState({
    loading: true,
    seasonYear: null,
    seasonType: null, // e.g., "reg", "post"
    label: "",
    displayLabel: "", // mirrors label
    value: null, // ESPN week value (string)
    countdown: "—",
    firstGame: null,
    start: null,
    end: null,
    order: null,
    prevWeekValue: null,
    isBeforeKickoff: false, // true if now < firstGame
    // Every weekly_results doc for this season, keyed by doc id. We already
    // read these to work out the current week, so callers that need one
    // (e.g. the dashboard's last-week winner) can take it from here instead
    // of waiting on this hook and then issuing their own read.
    weeklyResults: null,
  });

  useEffect(() => {
    let intervalId;
    const pad = (n) => String(n).padStart(2, "0");

    (async () => {
      try {
        const weeksRef = collection(db, "schedules", seasonId, "weeks");
        const snap = await getDocs(query(weeksRef, orderBy("order", "asc")));
        const rows = snap.docs.map((d) => {
          const data = d.data();
          return {
            ...data,
            id: d.id,
            start: tsToDate(data.start),
            end: tsToDate(data.end),
            firstGame: tsToDate(data.firstGame),
            value: data.value != null ? String(data.value) : null,
            order: typeof data.order === "number" ? data.order : null,
          };
        });

        if (!rows.length) {
          setState((p) => ({ ...p, loading: false }));
          return;
        }

        // A week is "done" once its weekly_results doc exists (written by the
        // Tuesday 2am compute job) — that's what actually advances "current
        // week" now, not the next week's kickoff time. Otherwise the site
        // would sit on a just-finished week for days until new games start.
        const seasonYear = rows[0]?.seasonYear;
        const weeklyResults = new Map();
        if (seasonYear != null) {
          const resultsSnap = await getDocs(
            query(collection(db, "weekly_results"), where("year", "==", seasonYear))
          );
          resultsSnap.docs.forEach((d) => weeklyResults.set(d.id, d.data()));
        }
        const weekDocId = (w) => `${w.seasonYear}-${w.seasonType}-W${w.value}`;

        const firstUncomputedIdx = rows.findIndex((w) => !weeklyResults.has(weekDocId(w)));
        const idx = firstUncomputedIdx !== -1 ? firstUncomputedIdx : rows.length - 1;
        const display = rows[idx];

        // Only meaningful within the same season type — rows[] is one
        // combined ordered list spanning preseason then regular season, so
        // at that boundary "previous row" is preseason's last week, not a
        // real "regular season week 0". Reusing its raw ESPN value with the
        // CURRENT week's seasonType produced nonsense like "Regular Week 4"
        // as "last week" when the current week was actually Regular Week 1.
        const prevWeekValue =
          idx > 0 && rows[idx - 1]?.value != null && rows[idx - 1]?.seasonType === display.seasonType
            ? String(rows[idx - 1].value)
            : null;

        const kickoffMs = display.firstGame?.getTime?.();
        const initialBeforeKickoff = typeof kickoffMs === "number" ? kickoffMs > Date.now() : false;

        const tick = () => {
          const fg = display.firstGame;
          const fgMs = fg?.getTime?.();
          if (!fg || typeof fgMs !== "number" || fgMs <= Date.now()) {
            setState((p) => ({ ...p, countdown: "—", isBeforeKickoff: false }));
            return;
          }
          const ms = fgMs - Date.now();
          const total = Math.floor(ms / 1000);
          const d = Math.floor(total / 86400);
          const h = Math.floor((total % 86400) / 3600);
          const m = Math.floor((total % 3600) / 60);
          const s = total % 60;
          setState((p) => ({
            ...p,
            countdown: `${pad(d)}:${pad(h)}:${pad(m)}:${pad(s)}`,
            isBeforeKickoff: true,
          }));
        };

        setState({
          loading: false,
          seasonYear: display.seasonYear ?? null,
          seasonType: display.seasonType ?? null,
          label: display.label ?? "",
          displayLabel: display.label ?? "",
          value: display.value ?? null,
          countdown: "—",
          firstGame: display.firstGame ?? null,
          start: display.start ?? null,
          end: display.end ?? null,
          order: display.order ?? null,
          prevWeekValue,
          isBeforeKickoff: initialBeforeKickoff,
          weeklyResults,
        });

        tick();
        clearInterval(intervalId);
        intervalId = setInterval(tick, 1000);
      } catch (e) {
        console.error("schedule load error", e);
        setState((p) => ({ ...p, loading: false, countdown: "—", isBeforeKickoff: false }));
      }
    })();

    return () => clearInterval(intervalId);
  }, [seasonId]);

  return state;
}
