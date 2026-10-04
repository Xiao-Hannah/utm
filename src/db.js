import mysql from "mysql2/promise";
import { config } from "./config.js";

export const pool = mysql.createPool({
  ...config.mysql,
  waitForConnections: true,
  connectionLimit: 10,
  maxIdle: 10,
  idleTimeout: 60_000,
  enableKeepAlive: true
});
