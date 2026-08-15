// scripts/seed_schedule_2026.js
// Pulls the 2026 NFL preseason + regular season calendar straight from ESPN
// and seeds schedules/nfl-2026/weeks/{id} in Firestore. No hand-typed dates.

const fs = require("fs");
const path = require("path");
const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");

const saPath = path.resolve(process.cwd(), "serviceAccount.json");
const serviceAccount = JSON.parse(fs.readFileSync(saPath, "utf-8"));
if (!getApps().length) initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const YEAR = 2026;
const SEASON_ID = `nfl-${YEAR}`;
const TYPE_NUM = { pre: 1, reg: 2 };

const scoreboardUrl = (week, seasontype) =>
  `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?year=${YEAR}&week=${week}&seasontype=${seasontype}`;

async function getFirstLastGame(week, seasontype) {
  const res = await fetch(scoreboardUrl(week, seasontype));
  const data = await res.json();
  const events = Array.isArray(data?.events) ? data.events : [];
  if (!events.length) return { firstGame: null, lastGame: null };
  const dates = events.map((e) => new Date(e.date)).sort((a, b) => a - b);
  return { firstGame: dates[0], lastGame: dates[dates.length - 1] };
}

async function main() {
  const calRes = await fetch(
    `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${YEAR}`
  );
  const calData = await calRes.json();
  const calendar = calData?.leagues?.[0]?.calendar || [];

  const preGroup = calendar.find((g) => g.label === "Preseason");
  const regGroup = calendar.find((g) => g.label === "Regular Season");
  if (!preGroup || !regGroup) throw new Error("Could not find preseason/regular season calendar groups");

  const weeks = [];
  let order = 0;

  preGroup.entries.forEach((entry, i) => {
    weeks.push({
      id: `pre-${i}`,
      seasonType: "pre",
      // Counting Hall of Fame Weekend as Preseason Week 1 (house convention,
      // differs from ESPN's own labels which treat it separately)
      label: `Preseason Week ${i + 1}`,
      value: entry.value,
      start: entry.startDate,
      end: entry.endDate,
      order: order++,
    });
  });

  regGroup.entries.forEach((entry, i) => {
    weeks.push({
      id: `reg-${i + 1}`,
      seasonType: "reg",
      label: entry.label.startsWith("Week") ? `Regular ${entry.label}` : entry.label,
      value: entry.value,
      start: entry.startDate,
      end: entry.endDate,
      order: order++,
    });
  });

  console.log(`Found ${weeks.length} weeks (${preGroup.entries.length} preseason + ${regGroup.entries.length} regular).`);

  const batch = db.batch();
  for (const w of weeks) {
    const seasontype = TYPE_NUM[w.seasonType];
    const { firstGame, lastGame } = await getFirstLastGame(w.value, seasontype);
    console.log(`  ${w.id} (${w.label}): firstGame=${firstGame?.toISOString() || "none"}`);

    const ref = db.doc(`schedules/${SEASON_ID}/weeks/${w.id}`);
    batch.set(
      ref,
      {
        seasonYear: YEAR,
        seasonType: w.seasonType,
        label: w.label,
        value: w.value,
        order: w.order,
        start: Timestamp.fromDate(new Date(w.start)),
        end: Timestamp.fromDate(new Date(w.end)),
        firstGame: firstGame ? Timestamp.fromDate(firstGame) : null,
        lastGame: lastGame ? Timestamp.fromDate(lastGame) : null,
        tz: "America/New_York",
      },
      { merge: true }
    );
  }

  await batch.commit();
  console.log(`\nSeeded ${weeks.length} week docs to schedules/${SEASON_ID}/weeks`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
