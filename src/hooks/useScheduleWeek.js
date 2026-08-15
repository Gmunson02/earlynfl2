// hooks/useScheduleWeek.js
import { useEffect, useState } from "react";
import { db } from "../lib/firebase";
import { collection, getDocs, orderBy, query } from "firebase/firestore";

// Firestore Timestamp helper (works for web Timestamp or admin {seconds,...})
function tsToDate(x) {
  if (!x) return null;
  if (typeof x.toDate === "function") return x.toDate();
  if (typeof x.seconds === "number") return new Date(x.seconds * 1000);
  return x instanceof Date ? x : null;
}

/**
 * Reads schedules/{seasonId}/weeks ordered by 'order'.
 * Picks active (start <= now < end) else next upcoming (start > now) else last.
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

        const now = new Date();
        const activeIdx = rows.findIndex((w) => w.start && w.end && w.start <= now && now < w.end);
        const nextIdx = rows.findIndex((w) => w.start && w.start > now);
        const idx = activeIdx !== -1 ? activeIdx : (nextIdx !== -1 ? nextIdx : rows.length - 1);
        const display = rows[idx];

        const prevWeekValue =
          idx > 0 && rows[idx - 1]?.value != null ? String(rows[idx - 1].value) : null;

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
