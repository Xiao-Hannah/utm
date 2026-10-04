import { pool } from "./db.js";
import { matchSignups } from "./matcher.js";

try {
  const result = await matchSignups();
  console.log(`Checked ${result.checked} signup records; matched ${result.matched} conversions.`);
} finally {
  await pool.end();
}
