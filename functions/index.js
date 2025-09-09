// Firebase Functions v2 (Node 20)
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

const DEFAULT_YEAR = 2025;
const DEFAULT_SEASON = "reg"; // "pre" | "reg" | "post"
const DEFAULT_WEEK = 1;       // start at regular season week 1
const MAX_WEEKS = 18;

const TYPE_MAP = { pre: 1, reg: 2, post: 3 };
const ESPN_URL = (y, w, type) =>
  `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?year=${y}&week=${w}&seasontype=${type}`;

// ---------- Helpers ----------
function allFinal(events) {
  return events.length > 0 &&
    events.every(e => e?.competitions?.[0]?.status?.type?.state === "post");
}

function getLastGameTotal(events) {
  // "Last game" by kickoff time → sort by date ASC and take last
  const sorted = [...events].sort((a, b) => new Date(a.date) - new Date(b.date));
  const last = sorted[sorted.length - 1];
  const comp = last?.competitions?.[0];
  if (!comp) return null;
  const home = comp.competitors?.find(c => c.homeAway === "home");
  const away = comp.competitors?.find(c => c.homeAway === "away");
  const hs = home?.score != null ? Number(home.score) : 0;
  const as = away?.score != null ? Number(away.score) : 0;
  return hs + as;
}

function buildWinners(standings, lastGameTotal) {
  if (!standings.length) return { winners: [], enriched: [] };

  const maxWins = Math.max(...standings.map(s => s.wins));
  const top = standings.filter(s => s.wins === maxWins);

  // Price Is Right: closest without going over to lastGameTotal
  const withTb = top.map(s => {
    const tb = Number(s.tieBreaker ?? NaN);
    const diff = lastGameTotal - tb;
    return { ...s, tbDiff: Math.abs(diff), tbOver: diff < 0 };
  });

  const nonOver = withTb.filter(s => !s.tbOver);
  if (nonOver.length) {
    const minDiff = Math.min(...nonOver.map(s => s.tbDiff));
    const winners = nonOver.filter(s => s.tbDiff === minDiff);
    return { winners, enriched: withTb };
  }

  // Everyone went over → smallest overage wins
  const minOver = Math.min(...withTb.map(s => s.tbDiff));
  const winners = withTb.filter(s => s.tbDiff === minOver);
  return { winners, enriched: withTb };
}

async function computeWeek(year, season, week) {
  const seasontype = TYPE_MAP[season] ?? 2;
  const rsp = await fetch(ESPN_URL(year, week, seasontype));
  if (!rsp.ok) throw new Error(`ESPN fetch failed: ${rsp.status}`);
  const data = await rsp.json();
  const events = Array.isArray(data?.events) ? data.events : [];
  if (!allFinal(events)) {
    return { computed: false, reason: "not_final" };
  }

  // Winners by event
  const winnersByEvent = {};
  for (const e of events) {
    const comp = e?.competitions?.[0];
    const w = comp?.competitors?.find(c => c.winner);
    if (w?.team?.shortDisplayName) winnersByEvent[e.id] = w.team.shortDisplayName;
  }

  // Load users and picks
  const [usersSnap, picksSnap] = await Promise.all([
    db.collection("users").get(),
    db.collection("picks").get(),
  ]);

  const usersMap = {};
  usersSnap.forEach(d => { usersMap[d.id] = d.data()?.displayName || ""; });

  const keyNew = `${year}-${season}-W${week}`;
  const keyLegacy = `${year}-W${week}`;

  const standings = [];
  for (const doc of picksSnap.docs) {
    const data = doc.data();
    const userData = data[keyNew] || data[keyLegacy];
    if (!userData) continue;

    let wins = 0;
    const tb = Number(userData.tieBreaker ?? NaN);

    for (const [eventID, pick] of Object.entries(userData)) {
      if (["tieBreaker","displayName","locked","submittedAt"].includes(eventID)) continue;
      const w = winnersByEvent[eventID];
      if (w && w === pick) wins++;
    }

    const uid = doc.id;
    const displayName = usersMap[uid] || userData.displayName || "Unknown";

    standings.push({
      uid,
      displayName,
      wins,
      tieBreaker: isNaN(tb) ? null : tb,
    });
  }

  const lastGameTotal = getLastGameTotal(events) ?? null;
  const { winners, enriched } = buildWinners(standings, lastGameTotal);

  // Winners as objects (uid + displayName)
  const winnersOut = winners.map(w => ({
    uid: w.uid,
    displayName: w.displayName,
  }));

  // Persist weekly_results (standings include displayName)
  const weeklyDocId = `${year}-${season}-W${week}`;
  const weeklyDoc = {
    year, season, week,
    lastGameTotal,
    computedAt: admin.firestore.FieldValue.serverTimestamp(),
    standings: (enriched.length ? enriched : standings).map(s => ({
      uid: s.uid,
      displayName: s.displayName || null,
      wins: s.wins,
      tieBreaker: s.tieBreaker ?? null,
      tbDiff: s.tbDiff ?? null,
      tbOver: !!s.tbOver,
    })),
    winners: winnersOut, // <-- now includes display names
  };
  await db.collection("weekly_results").doc(weeklyDocId).set(weeklyDoc, { merge: true });

  // Update season_leaderboard (store/refresh displayName)
  const seasonId = `${year}-${season}`;
  const seasonRef = db.collection("season_leaderboard").doc(seasonId);
  const seasonSnap = await seasonRef.get();
  const players = seasonSnap.exists ? (seasonSnap.data()?.players || {}) : {};

  for (const s of standings) {
    const rec = players[s.uid] || { weeksPlayed: 0, totalWins: 0, bestWeekWins: 0, weeklyWins: {}, displayName: s.displayName || null };
    rec.weeksPlayed += 1;
    rec.totalWins += s.wins;
    rec.bestWeekWins = Math.max(rec.bestWeekWins, s.wins);
    rec.weeklyWins[`W${week}`] = s.wins;
    rec.displayName = s.displayName || rec.displayName || null; // keep fresh
    players[s.uid] = rec;
  }

  await seasonRef.set({
    year, season,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    players,
  }, { merge: true });

  return { computed: true, week, winners: winnersOut };
}

// ---------- Scheduled job: Tue 2:00 AM Eastern ----------
exports.computeWeeklyWinners = onSchedule(
  {
    schedule: "0 2 * * TUE",
    timeZone: "America/New_York",
    region: "us-central1",
    memory: "256MiB",
  },
  async () => {
    const results = [];
    for (let w = 1; w <= MAX_WEEKS; w++) {
      const id = `${DEFAULT_YEAR}-${DEFAULT_SEASON}-W${w}`;
      const exists = (await db.collection("weekly_results").doc(id).get()).exists;
      if (exists) continue;

      try {
        const out = await computeWeek(DEFAULT_YEAR, DEFAULT_SEASON, w);
        if (out?.computed) results.push({ week: w, winners: out.winners });
      } catch (e) {
        console.error(`Week ${w} compute failed:`, e);
      }
    }
    console.log("Scheduled run results:", results);
    return null;
  }
);

// ---------- HTTP trigger: public + CORS ----------
// Defaults to 2025 • preseason • week 2 if no params are provided.
exports.computeWeeklyWinnersNow = onRequest(
  { region: "us-central1", invoker: "public" },
  async (req, res) => {
    // CORS
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.status(204).send("");

    try {
      const season = (req.query.season ? String(req.query.season) : DEFAULT_SEASON).toLowerCase();
      const year = req.query.year ? Number(req.query.year) : DEFAULT_YEAR;
      const week = req.query.week ? Number(req.query.week) : DEFAULT_WEEK;
      const mode = req.query.mode ? String(req.query.mode) : null;

      if (mode === "backfill") {
        const out = [];
        for (let w = 1; w <= MAX_WEEKS; w++) {
          const id = `${year}-${season}-W${w}`;
          const exists = (await db.collection("weekly_results").doc(id).get()).exists;
          if (exists) continue;
          const r = await computeWeek(year, season, w);
          if (r?.computed) out.push({ week: w, winners: r.winners });
        }
        return res.status(200).json({ ok: true, mode, results: out, defaults: { year, season } });
      }

      const result = await computeWeek(year, season, week);
      return res
        .status(200)
        .json({ ok: true, ...result, year, season, week, defaultsUsed: !req.query.week && !req.query.year && !req.query.season });
    } catch (err) {
      console.error("computeWeeklyWinnersNow error:", err);
      return res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  }
);
