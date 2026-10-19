import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { SESSION_DAYS, signSession, verifySession } from "../lib/auth.ts";

const secret = "x".repeat(40);
const now = new Date("2026-10-20T10:00:00Z");

describe("session cookie", () => {
  test("a fresh session is valid", () => {
    assert.equal(verifySession(signSession(secret, now), secret, now), true);
  });

  test("expires after the session lifetime", () => {
    const later = new Date(now.getTime() + (SESSION_DAYS * 86_400_000 + 1000));
    assert.equal(verifySession(signSession(secret, now), secret, later), false);
  });

  test("a changed expiry or signature is rejected", () => {
    const [exp, sig] = signSession(secret, now).split(".");
    assert.equal(verifySession(`${Number(exp) + 1}.${sig}`, secret, now), false);
    assert.equal(verifySession(`${exp}.${sig.slice(0, -1)}A`, secret, now), false);
  });

  test("another secret, an empty cookie or a short secret are rejected", () => {
    const value = signSession(secret, now);
    assert.equal(verifySession(value, "y".repeat(40), now), false);
    assert.equal(verifySession(undefined, secret, now), false);
    assert.equal(verifySession(value, "short", now), false);
    assert.equal(verifySession("garbage", secret, now), false);
  });
});
