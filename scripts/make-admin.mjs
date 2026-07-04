/**
 * Grant (or revoke) the admin role on an account — enables the god panel and
 * /give /tp /spawnmob /time /reload chat commands.
 *
 *   node scripts/make-admin.mjs <username> [--revoke]
 */
import { MongoClient } from "mongodb";
import { loadEnv } from "./lib.mjs";

loadEnv();
const username = process.argv[2];
const revoke = process.argv.includes("--revoke");
if (!username) {
  console.error("usage: node scripts/make-admin.mjs <username> [--revoke]");
  process.exit(1);
}

const client = new MongoClient(process.env.MONGO_URL ?? "mongodb://127.0.0.1:27017/fantasy_mmo");
await client.connect();
const accounts = client.db().collection("accounts");
const update = revoke ? { $pull: { roles: "admin" } } : { $addToSet: { roles: "admin" } };
const res = await accounts.updateOne({ username }, update);
if (res.matchedCount === 0) {
  console.error(`no account named '${username}'`);
  process.exit(1);
}
console.log(`${username} ${revoke ? "is no longer" : "is now"} an admin (takes effect on next login)`);
await client.close();
process.exit(0);
