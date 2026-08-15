// scripts/set_admin_claim.js
// Grants the admin custom claim used by firestore.rules' isAdmin() check.
// Usage: node scripts/set_admin_claim.js you@example.com

const fs = require("fs");
const path = require("path");
const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

const saPath = path.resolve(process.cwd(), "serviceAccount.json");
const serviceAccount = JSON.parse(fs.readFileSync(saPath, "utf-8"));
if (!getApps().length) initializeApp({ credential: cert(serviceAccount) });

const email = process.argv[2];
if (!email) {
  console.error("Usage: node scripts/set_admin_claim.js you@example.com");
  process.exit(1);
}

getAuth()
  .getUserByEmail(email)
  .then((user) => getAuth().setCustomUserClaims(user.uid, { admin: true }).then(() => user))
  .then((user) => {
    console.log(`Done. ${email} (${user.uid}) now has admin: true.`);
    console.log("They must sign out and back in for it to take effect.");
  })
  .catch((err) => {
    console.error("Failed:", err.message);
    process.exit(1);
  });
