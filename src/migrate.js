import fs from "node:fs/promises";
import mysql from "mysql2/promise";
import { config } from "./config.js";

const sql = await fs.readFile(new URL("../sql/schema.sql", import.meta.url), "utf8");
const connection = await mysql.createConnection({
  ...config.mysql,
  multipleStatements: true
});

try {
  await connection.query(sql);
  console.log("Referral schema is ready.");
} finally {
  await connection.end();
}
