// lib/liveDisplayNames.js
import { db } from "./firebase";
import { collection, getDocs } from "firebase/firestore";

// Current-season pages should always show a user's live display name, not
// whatever was recorded at pick-submission time. One cheap collection read
// (~70 users) beats denormalized snapshots going stale after a rename.
export async function fetchDisplayNameMap() {
  const snap = await getDocs(collection(db, "users"));
  const map = new Map();
  snap.forEach((d) => {
    const name = d.data()?.displayName;
    if (name) map.set(d.id, name);
  });
  return map;
}
