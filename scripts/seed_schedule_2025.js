// scripts/seed_schedule_2025.js
// Seeds 2025 NFL preseason + regular season weeks into Firestore in Eastern Time (your machine).
// No timezone libraries; relies on your machine being set to ET.

const fs = require("fs");
const path = require("path");
const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");

// ---- load service account (LOCAL ONLY) ----
const saPath = path.resolve(process.cwd(), "serviceAccount.json");
const serviceAccount = JSON.parse(fs.readFileSync(saPath, "utf-8"));

if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();

// Helper: make Firestore Timestamp in local time (ET on your machine)
// month is 1-based (Jan=1)
function ts(y, m, d, hh, mm) {
  return Timestamp.fromDate(new Date(y, m - 1, d, hh, mm));
}

/**
 * Fields:
 *  id: "pre-0" | "pre-1" ... "reg-18"
 *  seasonType: "pre" | "reg"
 *  value: ESPN calendar value used for routing (string)
 *  start/end: Tuesday window boundaries in ET (as Timestamps)
 *  firstGame/lastGame: optional metadata (ET)
 */
const WEEKS_2025 = [
  // --- PRESEASON ---
  {
    id: "pre-0",
    seasonYear: 2025,
    seasonType: "pre",
    label: "Hall of Fame Game",
    value: "0",
    order: 0,
    start: ts(2025, 7, 29, 5, 0),  // Tue Jul 29, 2025 05:00 ET
    end:   ts(2025, 8, 5, 3, 0),   // Tue Aug 05, 2025 03:00 ET
    firstGame: ts(2025, 7, 31, 20, 0),
    lastGame:  ts(2025, 7, 31, 23, 59),
    tz: "America/New_York",
  },
  {
    id: "pre-1",
    seasonYear: 2025,
    seasonType: "pre",
    label: "Preseason Week 1",
    value: "1",
    order: 1,
    start: ts(2025, 8, 5, 5, 0),   // Tue Aug 05, 05:00
    end:   ts(2025, 8, 12, 3, 0),  // Tue Aug 12, 03:00
    firstGame: ts(2025, 8, 7, 19, 0),
    lastGame:  ts(2025, 8, 10, 23, 59),
    tz: "America/New_York",
  },
  // NOTE: per your screenshot/observation, ESPN "value" for Pre Wk2 is "3"
  {
    id: "pre-2",
    seasonYear: 2025,
    seasonType: "pre",
    label: "Preseason Week 2",
    value: "3",
    order: 2,
    start: ts(2025, 8, 12, 5, 0),  // Tue Aug 12, 05:00
    end:   ts(2025, 8, 19, 3, 0),  // Tue Aug 19, 03:00
    firstGame: ts(2025, 8, 14, 19, 0),
    lastGame:  ts(2025, 8, 17, 23, 59),
    tz: "America/New_York",
  },
  {
    id: "pre-3",
    seasonYear: 2025,
    seasonType: "pre",
    label: "Preseason Week 3",
    value: "4",
    order: 3,
    start: ts(2025, 8, 19, 5, 0),  // Tue Aug 19, 05:00
    end:   ts(2025, 8, 26, 3, 0),  // Tue Aug 26, 03:00
    firstGame: ts(2025, 8, 21, 19, 0),
    lastGame:  ts(2025, 8, 23, 23, 59),
    tz: "America/New_York",
  },

  // --- REGULAR SEASON ---
  {
    id: "reg-1",
    seasonYear: 2025,
    seasonType: "reg",
    label: "Regular Week 1",
    value: "1",
    order: 4,
    start: ts(2025, 9, 2, 5, 0),   // Tue Sep 02, 05:00
    end:   ts(2025, 9, 9, 3, 0),   // Tue Sep 09, 03:00
    firstGame: ts(2025, 9, 4, 20, 20),
    lastGame:  ts(2025, 9, 8, 23, 59),
    tz: "America/New_York",
  },
  {
    id: "reg-2",
    seasonYear: 2025,
    seasonType: "reg",
    label: "Regular Week 2",
    value: "2",
    order: 5,
    start: ts(2025, 9, 9, 5, 0),
    end:   ts(2025, 9, 16, 3, 0),
    firstGame: ts(2025, 9, 11, 20, 20),
    lastGame:  ts(2025, 9, 15, 23, 59),
    tz: "America/New_York",
  },
  {
    id: "reg-3",
    seasonYear: 2025,
    seasonType: "reg",
    label: "Regular Week 3",
    value: "3",
    order: 6,
    start: ts(2025, 9, 16, 5, 0),
    end:   ts(2025, 9, 23, 3, 0),
    firstGame: ts(2025, 9, 18, 20, 20),
    lastGame:  ts(2025, 9, 22, 23, 59),
    tz: "America/New_York",
  },
  {
    id: "reg-4",
    seasonYear: 2025,
    seasonType: "reg",
    label: "Regular Week 4",
    value: "4",
    order: 7,
    start: ts(2025, 9, 23, 5, 0),
    end:   ts(2025, 9, 30, 3, 0),
    firstGame: ts(2025, 9, 25, 20, 20),
    lastGame:  ts(2025, 9, 29, 23, 59),
    tz: "America/New_York",
  },
  {
    id: "reg-5",
    seasonYear: 2025,
    seasonType: "reg",
    label: "Regular Week 5",
    value: "5",
    order: 8,
    start: ts(2025, 9, 30, 5, 0),
    end:   ts(2025, 10, 7, 3, 0),
    firstGame: ts(2025, 10, 2, 20, 20),
    lastGame:  ts(2025, 10, 6, 23, 59),
    tz: "America/New_York",
  },
  {
    id: "reg-6",
    seasonYear: 2025,
    seasonType: "reg",
    label: "Regular Week 6",
    value: "6",
    order: 9,
    start: ts(2025, 10, 7, 5, 0),
    end:   ts(2025, 10, 14, 3, 0),
    firstGame: ts(2025, 10, 9, 20, 20),
    lastGame:  ts(2025, 10, 13, 23, 59),
    tz: "America/New_York",
  },
  {
    id: "reg-7",
    seasonYear: 2025,
    seasonType: "reg",
    label: "Regular Week 7",
    value: "7",
    order: 10,
    start: ts(2025, 10, 14, 5, 0),
    end:   ts(2025, 10, 21, 3, 0),
    firstGame: ts(2025, 10, 16, 20, 20),
    lastGame:  ts(2025, 10, 20, 23, 59),
    tz: "America/New_York",
  },
  {
    id: "reg-8",
    seasonYear: 2025,
    seasonType: "reg",
    label: "Regular Week 8",
    value: "8",
    order: 11,
    start: ts(2025, 10, 21, 5, 0),
    end:   ts(2025, 10, 28, 3, 0),
    firstGame: ts(2025, 10, 23, 20, 20),
    lastGame:  ts(2025, 10, 27, 23, 59),
    tz: "America/New_York",
  },
  {
    id: "reg-9",
    seasonYear: 2025,
    seasonType: "reg",
    label: "Regular Week 9",
    value: "9",
    order: 12,
    start: ts(2025, 10, 28, 5, 0),
    end:   ts(2025, 11, 4, 3, 0),
    firstGame: ts(2025, 10, 30, 20, 20),
    lastGame:  ts(2025, 11, 3, 23, 59),
    tz: "America/New_York",
  },
  {
    id: "reg-10",
    seasonYear: 2025,
    seasonType: "reg",
    label: "Regular Week 10",
    value: "10",
    order: 13,
    start: ts(2025, 11, 4, 5, 0),
    end:   ts(2025, 11, 11, 3, 0),
    firstGame: ts(2025, 11, 6, 20, 20),
    lastGame:  ts(2025, 11, 10, 23, 59),
    tz: "America/New_York",
  },
  {
    id: "reg-11",
    seasonYear: 2025,
    seasonType: "reg",
    label: "Regular Week 11",
    value: "11",
    order: 14,
    start: ts(2025, 11, 11, 5, 0),
    end:   ts(2025, 11, 18, 3, 0),
    firstGame: ts(2025, 11, 13, 20, 20),
    lastGame:  ts(2025, 11, 17, 23, 59),
    tz: "America/New_York",
  },
  {
    id: "reg-12",
    seasonYear: 2025,
    seasonType: "reg",
    label: "Regular Week 12",
    value: "12",
    order: 15,
    start: ts(2025, 11, 18, 5, 0),
    end:   ts(2025, 11, 25, 3, 0),
    firstGame: ts(2025, 11, 20, 12, 30), // Thanksgiving window starts earlier
    lastGame:  ts(2025, 11, 24, 23, 59),
    tz: "America/New_York",
  },
  {
    id: "reg-13",
    seasonYear: 2025,
    seasonType: "reg",
    label: "Regular Week 13",
    value: "13",
    order: 16,
    start: ts(2025, 11, 25, 5, 0),
    end:   ts(2025, 12, 2, 3, 0),
    firstGame: ts(2025, 11, 27, 12, 30),
    lastGame:  ts(2025, 12, 1, 23, 59),
    tz: "America/New_York",
  },
  {
    id: "reg-14",
    seasonYear: 2025,
    seasonType: "reg",
    label: "Regular Week 14",
    value: "14",
    order: 17,
    start: ts(2025, 12, 2, 5, 0),
    end:   ts(2025, 12, 9, 3, 0),
    firstGame: ts(2025, 12, 4, 20, 20),
    lastGame:  ts(2025, 12, 8, 23, 59),
    tz: "America/New_York",
  },
  {
    id: "reg-15",
    seasonYear: 2025,
    seasonType: "reg",
    label: "Regular Week 15",
    value: "15",
    order: 18,
    start: ts(2025, 12, 9, 5, 0),
    end:   ts(2025, 12, 16, 3, 0),
    firstGame: ts(2025, 12, 11, 20, 20),
    lastGame:  ts(2025, 12, 15, 23, 59),
    tz: "America/New_York",
  },
  {
    id: "reg-16",
    seasonYear: 2025,
    seasonType: "reg",
    label: "Regular Week 16",
    value: "16",
    order: 19,
    start: ts(2025, 12, 16, 5, 0),
    end:   ts(2025, 12, 23, 3, 0),
    firstGame: ts(2025, 12, 18, 20, 20),
    lastGame:  ts(2025, 12, 22, 23, 59),
    tz: "America/New_York",
  },
  {
    id: "reg-17",
    seasonYear: 2025,
    seasonType: "reg",
    label: "Regular Week 17",
    value: "17",
    order: 20,
    start: ts(2025, 12, 23, 5, 0),
    end:   ts(2025, 12, 30, 3, 0),
    firstGame: ts(2025, 12, 25, 12, 0), // Christmas Day slate
    lastGame:  ts(2025, 12, 28, 23, 59),
    tz: "America/New_York",
  },
  {
    id: "reg-18",
    seasonYear: 2025,
    seasonType: "reg",
    label: "Regular Week 18",
    value: "18",
    order: 21,
    start: ts(2025, 12, 30, 5, 0),
    end:   ts(2026, 1, 6, 3, 0),
    firstGame: ts(2026, 1, 1, 13, 0),
    lastGame:  ts(2026, 1, 4, 23, 59),
    tz: "America/New_York",
  },
];

async function run() {
  const seasonId = "nfl-2025";
  const batch = db.batch();

  for (const w of WEEKS_2025) {
    const ref = db.doc(`schedules/${seasonId}/weeks/${w.id}`);
    batch.set(
      ref,
      {
        seasonYear: w.seasonYear,
        seasonType: w.seasonType,
        label: w.label,
        value: w.value || null,  // ESPN week "value" for routing
        order: w.order,
        start: w.start,
        end: w.end,
        firstGame: w.firstGame || null,
        lastGame: w.lastGame || null,
        tz: w.tz,
      },
      { merge: true }
    );
  }

  await batch.commit();
  console.log(`Seeded ${WEEKS_2025.length} week docs to schedules/${seasonId}/weeks`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
