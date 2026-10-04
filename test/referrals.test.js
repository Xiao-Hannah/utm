import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSignupUrl,
  createAmbassadorCode,
  signVisitorId,
  slugify,
  verifyVisitorCookie
} from "../src/referrals.js";

test("creates readable ambassador codes with a random suffix", () => {
  const code = createAmbassadorCode("Jäne", "Smith", () => Buffer.from("abcdef", "hex"));
  assert.equal(code, "jane-smith-abcdef");
  assert.equal(slugify("  Jane & Smith  "), "jane-smith");
});

test("signs and verifies visitor IDs", () => {
  const visitorId = "3d58a166-6d4d-4e69-9fd3-f384601c1bd4";
  const secret = "b".repeat(32);
  const signed = signVisitorId(visitorId, secret);

  assert.equal(verifyVisitorCookie(signed, secret), visitorId);
  assert.equal(verifyVisitorCookie(`${signed}tampered`, secret), null);
  assert.equal(verifyVisitorCookie(signed, "c".repeat(32)), null);
});

test("builds a signup URL attributed to the ambassador code", () => {
  const url = buildSignupUrl(
    "https://example.com/signup?existing=value",
    "jane-smith-abcdef"
  );

  assert.equal(url.searchParams.get("existing"), "value");
  assert.equal(url.searchParams.get("utm_source"), "ambassador");
  assert.equal(url.searchParams.get("utm_medium"), "referral");
  assert.equal(url.searchParams.get("utm_campaign"), "jane-smith-abcdef");
});
