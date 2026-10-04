import { spawn, spawnSync } from "node:child_process";
import mysql from "mysql2/promise";

const containerName = "utm-referral-mysql-test";
const baseUrl = "http://127.0.0.1:3100";
const mysqlPassword = "test-password";
const environment = {
  ...process.env,
  PORT: "3100",
  NODE_ENV: "development",
  BASE_URL: baseUrl,
  SIGNUP_URL: "https://example.test/signup",
  MYSQL_HOST: "127.0.0.1",
  MYSQL_PORT: "33306",
  MYSQL_USER: "root",
  MYSQL_PASSWORD: mysqlPassword,
  MYSQL_DATABASE: "referrals",
  SIGNUP_DATABASE: "referrals",
  SIGNUP_TABLE: "backend_userprofile",
  SIGNUP_ID_COLUMN: "id",
  SIGNUP_CREATED_AT_COLUMN: "date_created",
  SIGNUP_UTM_SOURCE_COLUMN: "utm_source",
  SIGNUP_UTM_MEDIUM_COLUMN: "utm_medium",
  SIGNUP_UTM_CAMPAIGN_COLUMN: "utm_campaign",
  SIGNUP_EMAIL_VERIFIED_COLUMN: "is_email_verified",
  ADMIN_USERNAME: "admin",
  ADMIN_PASSWORD: "integration-test-password",
  COOKIE_SECRET: "c".repeat(32)
};

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: "pipe",
    ...options
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout || "No output"}`
    );
  }
  return result.stdout.trim();
}

async function waitForMySql() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = spawnSync(
      "docker",
      [
        "exec",
        containerName,
        "mysqladmin",
        "ping",
        "-uroot",
        `-p${mysqlPassword}`,
        "--silent"
      ],
      { stdio: "ignore" }
    );
    if (result.status === 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error("MySQL did not become ready");
}

async function waitForServer() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // The server may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("Referral server did not become ready");
}

spawnSync("docker", ["rm", "-f", containerName], { stdio: "ignore" });

let server;
let connection;
let serverOutput = "";

try {
  run("docker", [
    "run",
    "-d",
    "--name",
    containerName,
    "-e",
    `MYSQL_ROOT_PASSWORD=${mysqlPassword}`,
    "-e",
    "MYSQL_DATABASE=referrals",
    "-p",
    "33306:3306",
    "mysql:8.4"
  ]);
  await waitForMySql();

  connection = await mysql.createConnection({
    host: environment.MYSQL_HOST,
    port: Number(environment.MYSQL_PORT),
    user: environment.MYSQL_USER,
    password: environment.MYSQL_PASSWORD,
    database: environment.MYSQL_DATABASE
  });
  await connection.execute(
    `CREATE TABLE backend_userprofile (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      email VARCHAR(255) UNIQUE,
      utm_source VARCHAR(255),
      utm_medium VARCHAR(255),
      utm_campaign VARCHAR(255),
      is_email_verified BOOLEAN NOT NULL DEFAULT FALSE,
      date_created DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3)
    )`
  );

  run(process.execPath, ["src/migrate.js"], { env: environment });

  server = spawn(process.execPath, ["src/server.js"], {
    env: environment,
    stdio: ["ignore", "pipe", "pipe"]
  });
  server.stdout.on("data", (chunk) => {
    serverOutput += chunk;
  });
  server.stderr.on("data", (chunk) => {
    serverOutput += chunk;
  });
  await waitForServer();

  const authorization = `Basic ${Buffer.from(
    `${environment.ADMIN_USERNAME}:${environment.ADMIN_PASSWORD}`
  ).toString("base64")}`;
  const createResponse = await fetch(`${baseUrl}/admin/ambassadors`, {
    method: "POST",
    headers: {
      authorization,
      origin: baseUrl,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({ first_name: "Jane", last_name: "Smith" }),
    redirect: "manual"
  });
  if (createResponse.status !== 303) {
    throw new Error(`Ambassador creation returned ${createResponse.status}`);
  }

  const [[ambassador]] = await connection.query("SELECT code FROM ambassadors LIMIT 1");
  const referralResponse = await fetch(`${baseUrl}/r/${ambassador.code}`, {
    redirect: "manual"
  });
  if (
    referralResponse.status !== 302 ||
    !referralResponse.headers.get("location")?.includes("utm_source=ambassador") ||
    !referralResponse.headers.get("location")?.includes(`utm_campaign=${ambassador.code}`)
  ) {
    throw new Error("Referral link did not redirect to the ambassador-tagged signup URL");
  }

  await connection.execute(
    `INSERT INTO backend_userprofile
       (email, utm_source, utm_medium, utm_campaign, is_email_verified)
     VALUES (?, ?, ?, ?, ?)`,
    ["person@example.com", "ambassador", "referral", ambassador.code, true]
  );
  const matchOutput = run(process.execPath, ["src/run-matcher.js"], { env: environment });
  if (!matchOutput.includes("matched 1 conversions")) {
    throw new Error(`Unexpected matcher output: ${matchOutput}`);
  }

  const secondMatchOutput = run(process.execPath, ["src/run-matcher.js"], { env: environment });
  if (!secondMatchOutput.includes("matched 0 conversions")) {
    throw new Error(`Matcher was not idempotent: ${secondMatchOutput}`);
  }

  await connection.execute(
    "UPDATE backend_userprofile SET is_email_verified = FALSE WHERE utm_campaign = ?",
    [ambassador.code]
  );
  run(process.execPath, ["src/run-matcher.js"], { env: environment });

  const [[result]] = await connection.query(
    `SELECT COUNT(*) AS conversions, SUM(email_verified) AS verified
     FROM referral_conversions`
  );
  if (Number(result.conversions) !== 1 || Number(result.verified) !== 0) {
    throw new Error(
      `Expected one unverified conversion, found ${result.conversions} conversions and ${result.verified} verified`
    );
  }

  console.log(
    `End-to-end referral flow passed with code ${ambassador.code} and one matched conversion.`
  );
} catch (error) {
  if (serverOutput) {
    console.error(serverOutput);
  }
  throw error;
} finally {
  await connection?.end();
  if (server?.exitCode === null) {
    server.kill("SIGTERM");
    await new Promise((resolve) => server.once("exit", resolve));
  }
  spawnSync("docker", ["rm", "-f", containerName], { stdio: "ignore" });
}
