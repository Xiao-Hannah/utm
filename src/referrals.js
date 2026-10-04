import crypto from "node:crypto";

export function slugify(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

export function createAmbassadorCode(firstName, lastName, randomBytes = crypto.randomBytes) {
  const name = slugify(`${firstName} ${lastName}`) || "ambassador";
  return `${name}-${randomBytes(3).toString("hex")}`;
}

export function signVisitorId(visitorId, secret) {
  const signature = crypto.createHmac("sha256", secret).update(visitorId).digest("base64url");
  return `${visitorId}.${signature}`;
}

export function verifyVisitorCookie(cookieValue, secret) {
  if (!cookieValue) {
    return null;
  }

  const separator = cookieValue.lastIndexOf(".");
  if (separator < 1) {
    return null;
  }

  const visitorId = cookieValue.slice(0, separator);
  const supplied = Buffer.from(cookieValue.slice(separator + 1), "utf8");
  const expected = Buffer.from(
    crypto.createHmac("sha256", secret).update(visitorId).digest("base64url"),
    "utf8"
  );

  if (
    supplied.length !== expected.length ||
    !crypto.timingSafeEqual(supplied, expected) ||
    !/^[0-9a-f-]{36}$/i.test(visitorId)
  ) {
    return null;
  }

  return visitorId;
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function buildSignupUrl(signupUrl, ambassadorCode) {
  const url = new URL(signupUrl);
  // These fixed values separate ambassador traffic from other acquisition channels.
  url.searchParams.set("utm_source", "ambassador");
  url.searchParams.set("utm_medium", "referral");
  url.searchParams.set("utm_campaign", ambassadorCode);
  return url;
}
