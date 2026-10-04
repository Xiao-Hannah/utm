# Ambassador referrals

A small first-pass referral service that creates ambassador links and matches UTM-tagged accounts created in the existing MySQL `backend_userprofile` table. It does not require changes to the signup website because that table already stores UTM values.

## How it works

1. An administrator creates an ambassador at `/admin`.
2. The service generates a link such as `/r/jane-smith-a1b2c3`.
3. The referral endpoint records a click and redirects to the existing signup page with `utm_source=ambassador`, `utm_medium=referral`, and the ambassador code in `utm_campaign`.
4. The existing signup path stores those values on `backend_userprofile`.
5. `npm run match` associates each matching user ID with the ambassador and records whether the email is verified.

An account row created with the ambassador UTM values is the primary conversion. Email verification is shown separately as a secondary quality metric.

## Local setup

Requires Node.js and access to a MySQL database where the referral tables can be created. The configured MySQL account also needs read access to the existing signup table.

```bash
cp .env.example .env
npm install
npm run migrate
npm start
```

Open `http://localhost:3000/admin` and sign in with `ADMIN_USERNAME` and `ADMIN_PASSWORD`.

Generate strong secrets with:

```bash
openssl rand -hex 32
```

## Signup matching

Configure the existing signup table in `.env`:

```text
SIGNUP_DATABASE=app
SIGNUP_TABLE=backend_userprofile
SIGNUP_ID_COLUMN=id
SIGNUP_CREATED_AT_COLUMN=date_created
SIGNUP_UTM_SOURCE_COLUMN=utm_source
SIGNUP_UTM_MEDIUM_COLUMN=utm_medium
SIGNUP_UTM_CAMPAIGN_COLUMN=utm_campaign
SIGNUP_EMAIL_VERIFIED_COLUMN=is_email_verified
```

Run matching manually:

```bash
npm run match
```

For automation, schedule that command hourly using cron or the eventual hosting platform's scheduler.

## Validation

Run unit tests:

```bash
npm test
```

With Docker running, execute the complete MySQL flow in an isolated temporary container:

```bash
npm run test:integration
```

The integration check migrates the schema, creates an ambassador, verifies its tagged redirect, inserts a UTM-attributed signup, runs the matcher, verifies one conversion, and removes the temporary container.

## MySQL permissions

For production, use a dedicated database account with:

- `SELECT`, `INSERT`, and `UPDATE` on the referral database.
- `SELECT` only on the configured signup table.

Do not commit `.env`; it contains database credentials and HMAC secrets.
