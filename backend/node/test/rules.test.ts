import assert from "node:assert/strict";
import test from "node:test";
import { ensurePublishable, hashPassword, normalizeIndiaPhone, pollResultsVisible, readMagic, signMagic, verifyPassword } from "../src/security.ts";

test("Indian mobile numbers normalize to E.164", () => {
  assert.equal(normalizeIndiaPhone("9876543210"), "+919876543210");
  assert.equal(normalizeIndiaPhone("+91 98765 43210"), "+919876543210");
  assert.throws(() => normalizeIndiaPhone("123"), /10-digit/);
});

test("posts reject email, phone, and government id patterns", () => {
  assert.throws(() => ensurePublishable("write me at person@example.com"), /email address/);
  assert.throws(() => ensurePublishable("call 9876543210"), /phone number/);
  assert.throws(() => ensurePublishable("ABCDE1234F"), /government identity/);
  assert.doesNotThrow(() => ensurePublishable("A fictional on-call rota"));
});

test("poll results stay hidden until the poll is closed and at least 5 ballots exist", () => {
  assert.equal(pollResultsVisible("Open", 9, 5), false);
  assert.equal(pollResultsVisible("Closed", 4, 5), false);
  assert.equal(pollResultsVisible("Closed", 4, 1), false);
  assert.equal(pollResultsVisible("Closed", 5, 5), true);
});

test("password hashes match only the same password", async () => {
  const hash = await hashPassword("change-me-strong-bootstrap-password");
  assert.equal(await verifyPassword("change-me-strong-bootstrap-password", hash), true);
  assert.equal(await verifyPassword("wrong-password", hash), false);
  assert.equal(await verifyPassword("change-me-strong-bootstrap-password", "not-a-hash"), false);
  assert.match(hash, /^\$2[aby]\$/);
});

test("magic links round-trip and reject the wrong purpose", () => {
  const token = signMagic({ email: "staff@example.com", purpose: "login", jti: "jti-1", exp: Math.floor(Date.now() / 1000) + 60 });
  assert.equal(readMagic(token, "login").email, "staff@example.com");
  assert.throws(() => readMagic(token, "deletion"), /not valid|expired/);
});
