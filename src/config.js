import "dotenv/config";

const identifierPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function identifier(name, fallback) {
  const value = process.env[name]?.trim() || fallback;
  if (!identifierPattern.test(value)) {
    throw new Error(`${name} must be a valid MySQL identifier`);
  }
  return value;
}

function positiveInteger(name, fallback) {
  const value = Number.parseInt(process.env[name] || String(fallback), 10);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function secret(name) {
  const value = required(name);
  if (value.length < 32) {
    throw new Error(`${name} must contain at least 32 characters`);
  }
  return value;
}

const mysqlDatabase = identifier("MYSQL_DATABASE", "referrals");

export const config = {
  port: positiveInteger("PORT", 3000),
  nodeEnv: process.env.NODE_ENV || "development",
  baseUrl: new URL(required("BASE_URL")),
  signupUrl: new URL(required("SIGNUP_URL")),
  mysql: {
    host: required("MYSQL_HOST"),
    port: positiveInteger("MYSQL_PORT", 3306),
    user: required("MYSQL_USER"),
    password: required("MYSQL_PASSWORD"),
    database: mysqlDatabase
  },
  signup: {
    database: identifier("SIGNUP_DATABASE", mysqlDatabase),
    table: identifier("SIGNUP_TABLE", "backend_userprofile"),
    idColumn: identifier("SIGNUP_ID_COLUMN", "id"),
    createdAtColumn: identifier("SIGNUP_CREATED_AT_COLUMN", "date_created"),
    utmSourceColumn: identifier("SIGNUP_UTM_SOURCE_COLUMN", "utm_source"),
    utmMediumColumn: identifier("SIGNUP_UTM_MEDIUM_COLUMN", "utm_medium"),
    utmCampaignColumn: identifier("SIGNUP_UTM_CAMPAIGN_COLUMN", "utm_campaign"),
    emailVerifiedColumn: identifier(
      "SIGNUP_EMAIL_VERIFIED_COLUMN",
      "is_email_verified"
    )
  },
  admin: {
    username: required("ADMIN_USERNAME"),
    password: required("ADMIN_PASSWORD")
  },
  cookieSecret: secret("COOKIE_SECRET")
};
