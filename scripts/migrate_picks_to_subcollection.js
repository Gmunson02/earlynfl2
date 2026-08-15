// scripts/migrate_picks_to_subcollection.js
// Copies picks/{uid} map-field weeks into picks/{uid}/weeks/{weekKey} subcollection docs.
// Does NOT delete the old fields — safe to re-run, safe to review before cleanup.

const fs = require("fs");
const path = require("path");
const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const saPath = path.resolve(process.cwd(), "serviceAccount.json");
const serviceAccount = JSON.parse(fs.readFileSync(saPath, "utf-8"));

if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();

const SYSTEM_KEYS = new Set(["tieBreaker", "displayName", "locked", "submittedAt", "lastEditedAt"]);

// Matches "2025-reg-W1" or legacy "2025-W1"
function isWeekKey(key) {
  return /^\d{4}(-[a-z]+)?-W\d+$/i.test(key);
}

async function main() {
  const picksSnap = await db.collection("picks").get();
  console.log(`Found ${picksSnap.size} user pick docs.`);

  let usersMigrated = 0;
  let weekDocsWritten = 0;

  for (const userDoc of picksSnap.docs) {
    const uid = userDoc.id;
    const data = userDoc.data();
    const weekKeys = Object.keys(data).filter(isWeekKey);

    if (!weekKeys.length) continue;

    const batch = db.batch();
    for (const weekKey of weekKeys) {
      const weekData = data[weekKey];
      if (!weekData || typeof weekData !== "object") continue;

      const ref = db.collection("picks").doc(uid).collection("weeks").doc(weekKey);
      batch.set(ref, weekData, { merge: true });
      weekDocsWritten++;
    }

    await batch.commit();
    usersMigrated++;
    console.log(`  migrated ${uid}: ${weekKeys.length} week(s)`);
  }

  console.log(`\nDone. Users migrated: ${usersMigrated}. Week docs written: ${weekDocsWritten}.`);
  console.log("Old fields on picks/{uid} were left in place — nothing was deleted.");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
