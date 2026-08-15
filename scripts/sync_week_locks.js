// scripts/sync_week_locks.js
// Reads schedules/{seasonId}/weeks and writes matching week_locks/{weekKey} docs
// so security rules can enforce "no picks after kickoff".
// Usage: node scripts/sync_week_locks.js nfl-2025

const fs = require("fs");
const path = require("path");
const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const saPath = path.resolve(process.cwd(), "serviceAccount.json");
const serviceAccount = JSON.parse(fs.readFileSync(saPath, "utf-8"));
if (!getApps().length) initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const SEASON_ID = process.argv[2] || "nfl-2025";

async function main() {
  const weeksSnap = await db.collection("schedules").doc(SEASON_ID).collection("weeks").get();
  console.log(`Found ${weeksSnap.size} week docs under schedules/${SEASON_ID}/weeks`);

  const batch = db.batch();
  let written = 0;

  for (const doc of weeksSnap.docs) {
    const d = doc.data();
    if (!d.firstGame || !d.seasonYear || !d.seasonType || d.value == null) {
      console.log(`  skip ${doc.id}: missing firstGame/seasonYear/seasonType/value`);
      continue;
    }
    const weekKey = `${d.seasonYear}-${d.seasonType}-W${d.value}`;
    batch.set(db.collection("week_locks").doc(weekKey), { locksAt: d.firstGame }, { merge: true });
    written++;
    console.log(`  ${weekKey} locks at ${d.firstGame.toDate ? d.firstGame.toDate().toISOString() : d.firstGame}`);
  }

  await batch.commit();
  console.log(`\nDone. week_locks written: ${written}`);
}

main().catch((err) => {
  console.error("Sync failed:", err);
  process.exit(1);
});
