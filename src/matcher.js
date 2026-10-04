import { config } from "./config.js";
import { pool } from "./db.js";

function quoteIdentifier(value) {
  return `\`${value}\``;
}

export async function matchSignups() {
  const [ambassadors] = await pool.query(
    "SELECT id, code, created_at FROM ambassadors ORDER BY created_at"
  );
  if (ambassadors.length === 0) {
    return { checked: 0, matched: 0 };
  }

  const ambassadorsByCode = new Map(
    ambassadors.map((ambassador) => [ambassador.code, ambassador])
  );
  const earliestAmbassador = new Date(ambassadors[0].created_at);

  const signup = config.signup;
  const query = `
    SELECT
      ${quoteIdentifier(signup.idColumn)} AS signup_id,
      ${quoteIdentifier(signup.createdAtColumn)} AS signup_created_at,
      ${quoteIdentifier(signup.utmCampaignColumn)} AS ambassador_code,
      ${quoteIdentifier(signup.emailVerifiedColumn)} AS signup_email_verified
    FROM ${quoteIdentifier(signup.database)}.${quoteIdentifier(signup.table)}
    WHERE ${quoteIdentifier(signup.utmSourceColumn)} = ?
      AND ${quoteIdentifier(signup.utmMediumColumn)} = ?
      AND ${quoteIdentifier(signup.utmCampaignColumn)} IS NOT NULL
      AND ${quoteIdentifier(signup.createdAtColumn)} >= ?
  `;
  const [users] = await pool.execute(query, [
    "ambassador",
    "referral",
    earliestAmbassador
  ]);

  const connection = await pool.getConnection();
  let matched = 0;
  try {
    await connection.beginTransaction();

    for (const user of users) {
      const ambassador = ambassadorsByCode.get(String(user.ambassador_code));
      if (!ambassador) {
        continue;
      }

      const [result] = await connection.execute(
        `INSERT INTO referral_conversions
           (ambassador_id, signup_user_id, converted_at, email_verified)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           email_verified = VALUES(email_verified)`,
        [
          ambassador.id,
          String(user.signup_id),
          new Date(user.signup_created_at),
          Boolean(user.signup_email_verified)
        ]
      );
      if (result.affectedRows === 1 && result.insertId) {
        matched += 1;
      }
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  return { checked: users.length, matched };
}
