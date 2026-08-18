// hooks/useWeekLabel.js
import { useEffect, useState } from "react";
import { db } from "../lib/firebase";
import { collection, getDocs, query, where } from "firebase/firestore";

// Looks up the human label (e.g. "Preseason Week 1") for a given
// year/seasonType/week combo from schedules/{seasonId}/weeks — the raw
// route "week" param is ESPN's own week number and isn't always what we
// want to display (e.g. Hall of Fame Weekend is ESPN's week 1, but our
// house labels start "Preseason Week 1" the week after).
// Pass `initialLabel` when the caller already resolved it server-side (see
// lib/weekLabels.js) — the lookup is then skipped entirely, so the heading
// never briefly renders the raw ESPN week number.
export default function useWeekLabel(year, seasonType, weekValue, initialLabel = null) {
  const [label, setLabel] = useState(initialLabel ?? null);

  useEffect(() => {
    if (initialLabel) {
      setLabel(initialLabel);
      return;
    }
    if (!year || !seasonType || weekValue == null) {
      setLabel(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const seasonId = `nfl-${year}`;
      const snap = await getDocs(
        query(collection(db, "schedules", seasonId, "weeks"), where("seasonType", "==", seasonType))
      );
      if (cancelled) return;
      const match = snap.docs.find((d) => String(d.data().value) === String(weekValue));
      setLabel(match?.data()?.label || null);
    })();
    return () => {
      cancelled = true;
    };
  }, [year, seasonType, weekValue, initialLabel]);

  return label;
}
