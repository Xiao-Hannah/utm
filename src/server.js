import crypto from "node:crypto";
import express from "express";
import { config } from "./config.js";
import { pool } from "./db.js";
import { matchSignups } from "./matcher.js";
import {
  buildSignupUrl,
  createAmbassadorCode,
  escapeHtml,
  signVisitorId,
  verifyVisitorCookie
} from "./referrals.js";

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(express.urlencoded({ extended: false, limit: "10kb" }));
app.use((request, response, next) => {
  response.set({
    "Content-Security-Policy":
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff"
  });
  next();
});

function parseCookies(header = "") {
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .flatMap((part) => {
        const separator = part.indexOf("=");
        if (separator < 1) {
          return [];
        }
        return [[
          decodeURIComponent(part.slice(0, separator)),
          decodeURIComponent(part.slice(separator + 1))
        ]];
      })
  );
}

function visitorId(request, response) {
  const existing = verifyVisitorCookie(
    parseCookies(request.headers.cookie).referral_visitor,
    config.cookieSecret
  );
  if (existing) {
    return existing;
  }

  const created = crypto.randomUUID();
  const signed = signVisitorId(created, config.cookieSecret);
  response.cookie("referral_visitor", signed, {
    httpOnly: true,
    maxAge: 365 * 24 * 60 * 60 * 1000,
    sameSite: "lax",
    secure: config.nodeEnv === "production",
    path: "/"
  });
  return created;
}

function page(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
    body { margin: 0 auto; max-width: 960px; padding: 2rem 1rem; }
    form { display: grid; gap: .75rem; margin: 1rem 0 2rem; max-width: 520px; }
    input, button { font: inherit; padding: .7rem; }
    button { cursor: pointer; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border-bottom: 1px solid #8886; padding: .7rem; text-align: left; }
    .muted { opacity: .75; }
    .notice { background: #2b7a2b22; border: 1px solid #2b7a2b88; padding: .75rem; }
    code { overflow-wrap: anywhere; }
  </style>
</head>
<body>${body}</body>
</html>`;
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left ?? ""));
  const rightBuffer = Buffer.from(String(right ?? ""));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function requireAdmin(request, response, next) {
  const authorization = request.headers.authorization || "";
  const [scheme, encoded] = authorization.split(" ");
  if (scheme !== "Basic" || !encoded) {
    response.set("WWW-Authenticate", 'Basic realm="Ambassador referrals"');
    return response.status(401).send("Authentication required");
  }

  const [username, ...passwordParts] = Buffer.from(encoded, "base64").toString().split(":");
  const password = passwordParts.join(":");
  if (
    !safeEqual(username, config.admin.username) ||
    !safeEqual(password, config.admin.password)
  ) {
    response.set("WWW-Authenticate", 'Basic realm="Ambassador referrals"');
    return response.status(401).send("Invalid credentials");
  }

  response.set("Cache-Control", "no-store");
  next();
}

function requireSameOrigin(request, response, next) {
  const origin = request.get("origin");
  if (origin && origin !== config.baseUrl.origin) {
    return response.status(403).send("Cross-origin request rejected");
  }
  next();
}

async function findAmbassador(code) {
  const [rows] = await pool.execute(
    "SELECT id, first_name, last_name, code FROM ambassadors WHERE code = ? LIMIT 1",
    [code]
  );
  return rows[0] || null;
}

app.get("/health", async (_request, response, next) => {
  try {
    await pool.query("SELECT 1");
    response.json({ status: "ok" });
  } catch (error) {
    next(error);
  }
});

app.get("/r/:code", async (request, response, next) => {
  try {
    const ambassador = await findAmbassador(request.params.code);
    if (!ambassador) {
      return response.status(404).send(page("Link not found", "<h1>Referral link not found</h1>"));
    }

    const id = visitorId(request, response);
    const userAgent = request.get("user-agent");
    const userAgentHash = userAgent
      ? crypto.createHash("sha256").update(userAgent).digest()
      : null;
    await pool.execute(
      `INSERT INTO referral_clicks (ambassador_id, visitor_id, user_agent_hash)
       VALUES (?, ?, ?)`,
      [ambassador.id, id, userAgentHash]
    );

    response.redirect(302, buildSignupUrl(config.signupUrl, ambassador.code).toString());
  } catch (error) {
    next(error);
  }
});

app.get("/admin", requireAdmin, async (request, response, next) => {
  try {
    const [ambassadors] = await pool.query(
      `SELECT
         a.id,
         a.first_name,
         a.last_name,
         a.code,
         COALESCE(c.unique_clicks, 0) AS unique_clicks,
         COALESCE(v.conversions, 0) AS conversions,
         COALESCE(v.verified_conversions, 0) AS verified_conversions
       FROM ambassadors a
       LEFT JOIN (
         SELECT ambassador_id, COUNT(DISTINCT visitor_id) AS unique_clicks
         FROM referral_clicks
         GROUP BY ambassador_id
       ) c ON c.ambassador_id = a.id
       LEFT JOIN (
         SELECT
           ambassador_id,
           COUNT(*) AS conversions,
           SUM(email_verified) AS verified_conversions
         FROM referral_conversions
         GROUP BY ambassador_id
       ) v ON v.ambassador_id = a.id
       ORDER BY a.created_at DESC`
    );

    const rows = ambassadors
      .map((ambassador) => {
        const clicks = Number(ambassador.unique_clicks);
        const conversions = Number(ambassador.conversions);
        const conversionRate = clicks > 0 ? `${((conversions / clicks) * 100).toFixed(1)}%` : "—";
        const link = new URL(`/r/${ambassador.code}`, config.baseUrl).toString();
        return `<tr>
          <td>${escapeHtml(ambassador.first_name)} ${escapeHtml(ambassador.last_name)}</td>
          <td><code>${escapeHtml(link)}</code></td>
          <td>${clicks}</td>
          <td>${conversions}</td>
          <td>${Number(ambassador.verified_conversions)}</td>
          <td>${conversionRate}</td>
        </tr>`;
      })
      .join("");

    const notice = request.query.matched
      ? `<p class="notice">Signup matching completed: ${escapeHtml(request.query.matched)} new conversion(s).</p>`
      : "";

    response.send(
      page(
        "Ambassador referrals",
        `<h1>Ambassador referrals</h1>
         ${notice}
         <h2>Create ambassador</h2>
         <form method="post" action="/admin/ambassadors">
           <label for="first_name">First name</label>
           <input id="first_name" name="first_name" required maxlength="100">
           <label for="last_name">Last name</label>
           <input id="last_name" name="last_name" required maxlength="100">
           <button type="submit">Create ambassador link</button>
         </form>
         <form method="post" action="/admin/match">
           <button type="submit">Match new signups now</button>
         </form>
         <table>
           <thead><tr><th>Ambassador</th><th>Link</th><th>Unique clicks</th><th>Accounts</th><th>Verified accounts</th><th>Conversion</th></tr></thead>
           <tbody>${rows || '<tr><td colspan="6">No ambassadors yet.</td></tr>'}</tbody>
         </table>`
      )
    );
  } catch (error) {
    next(error);
  }
});

app.post(
  "/admin/ambassadors",
  requireAdmin,
  requireSameOrigin,
  async (request, response, next) => {
    try {
      const firstName = String(request.body.first_name || "").trim();
      const lastName = String(request.body.last_name || "").trim();
      if (!firstName || !lastName || firstName.length > 100 || lastName.length > 100) {
        return response.status(400).send("Valid first and last names are required");
      }

      let created = false;
      for (let attempt = 0; attempt < 3 && !created; attempt += 1) {
        const code = createAmbassadorCode(firstName, lastName);
        try {
          await pool.execute(
            "INSERT INTO ambassadors (first_name, last_name, code) VALUES (?, ?, ?)",
            [firstName, lastName, code]
          );
          created = true;
        } catch (error) {
          if (error.code !== "ER_DUP_ENTRY") {
            throw error;
          }
        }
      }

      if (!created) {
        throw new Error("Could not generate a unique ambassador code");
      }
      response.redirect(303, "/admin");
    } catch (error) {
      next(error);
    }
  }
);

app.post("/admin/match", requireAdmin, requireSameOrigin, async (_request, response, next) => {
  try {
    const result = await matchSignups();
    response.redirect(303, `/admin?matched=${result.matched}`);
  } catch (error) {
    next(error);
  }
});

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(500).send(page("Error", "<h1>Something went wrong</h1>"));
});

const server = app.listen(config.port, () => {
  console.log(`Ambassador referrals listening at ${config.baseUrl}`);
});

async function shutdown() {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
