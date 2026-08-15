// scripts/archive_2025_reset_users.js
// One-time season reset: backs up, then deletes every account/profile/picks
// record except the given KEEP_UID. Leaves weekly_results and
// season_leaderboard (2025) untouched as static history. Also removes the
// now-unreferenced 2025 schedule and its week_locks entries.

const fs = require("fs");
const path = require("path");
const { initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");

const saPath = path.resolve(process.cwd(), "serviceAccount.json");
const serviceAccount = JSON.parse(fs.readFileSync(saPath, "utf-8"));
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const KEEP_UID = "cC03xNmAZgVlysLB2TqEEfcwcDf2"; // Greg

async function backup() {
  console.log("== Backing up before deletion ==");
  const out = { users: {}, picks: {}, schedules_2025: {}, week_locks_2025: {} };

  const usersSnap = await db.collection("users").get();
  usersSnap.forEach((d) => (out.users[d.id] = d.data()));

  const picksSnap = await db.collection("picks").get();
  for (const doc of picksSnap.docs) {
    const weeksSnap = await doc.ref.collection("weeks").get();
    out.picks[doc.id] = {
      legacyFields: doc.data(),
      weeks: Object.fromEntries(weeksSnap.docs.map((w) => [w.id, w.data()])),
    };
  }

  const schedWeeksSnap = await db.collection("schedules").doc("nfl-2025").collection("weeks").get();
  schedWeeksSnap.forEach((d) => (out.schedules_2025[d.id] = d.data()));

  const locksSnap = await db.collection("week_locks").get();
  locksSnap.forEach((d) => {
    if (d.id.startsWith("2025-")) out.week_locks_2025[d.id] = d.data();
  });

  const file = path.resolve(process.cwd(), `.backup_2025_reset_${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(out, (k, v) => (v?.toDate ? v.toDate().toISOString() : v), 2));
  console.log(
    `Backed up ${usersSnap.size} users, ${picksSnap.size} picks docs, ${schedWeeksSnap.size} 2025 schedule weeks, ${Object.keys(out.week_locks_2025).length} 2025 week_locks to:\n  ${file}`
  );
}

async function deleteAuthUsersExcept(keepUid) {
  console.log("\n== Deleting Firebase Auth accounts ==");
  let total = 0;
  let deleted = 0;
  let nextPageToken;
  do {
    const res = await getAuth().listUsers(1000, nextPageToken);
    const toDelete = res.users.map((u) => u.uid).filter((uid) => uid !== keepUid);
    total += res.users.length;
    if (toDelete.length) {
      const result = await getAuth().deleteUsers(toDelete);
      deleted += result.successCount;
      if (result.failureCount) {
        console.error(`  ${result.failureCount} auth deletions failed:`, result.errors.slice(0, 5));
      }
    }
    nextPageToken = res.pageToken;
  } while (nextPageToken);
  console.log(`Deleted ${deleted}/${total - 1} Auth accounts (kept ${keepUid}).`);
}

async function deleteFirestoreExcept(keepUid) {
  console.log("\n== Deleting Firestore users/picks ==");

  const usersSnap = await db.collection("users").get();
  let userBatch = db.batch();
  let uCount = 0;
  for (const doc of usersSnap.docs) {
    if (doc.id === keepUid) continue;
    userBatch.delete(doc.ref);
    uCount++;
    if (uCount % 400 === 0) {
      await userBatch.commit();
      userBatch = db.batch();
    }
  }
  await userBatch.commit();
  console.log(`Deleted ${uCount} users docs.`);

  const picksSnap = await db.collection("picks").get();
  let pCount = 0;
  for (const doc of picksSnap.docs) {
    if (doc.id === keepUid) continue;
    await db.recursiveDelete(doc.ref);
    pCount++;
  }
  console.log(`Deleted ${pCount} picks docs (with weeks subcollections).`);
}

async function deleteStale2025() {
  console.log("\n== Deleting unreferenced 2025 schedule + week_locks ==");
  await db.recursiveDelete(db.collection("schedules").doc("nfl-2025"));
  console.log("Deleted schedules/nfl-2025.");

  const locksSnap = await db.collection("week_locks").get();
  let batch = db.batch();
  let n = 0;
  for (const doc of locksSnap.docs) {
    if (!doc.id.startsWith("2025-")) continue;
    batch.delete(doc.ref);
    n++;
  }
  if (n) await batch.commit();
  console.log(`Deleted ${n} 2025 week_locks docs.`);
}

async function main() {
  await backup();
  await deleteAuthUsersExcept(KEEP_UID);
  await deleteFirestoreExcept(KEEP_UID);
  await deleteStale2025();
  console.log("\nDone. weekly_results and season_leaderboard (2025) were left untouched.");
}

main().catch((err) => {
  console.error("Reset failed:", err);
  process.exit(1);
});
