import assert from "node:assert/strict";
import test from "node:test";
import { HealthController } from "../src/health.controller";

test("nest health skeleton reports ok", () => {
  const body = new HealthController().health();
  assert.equal(body.status, "ok");
  assert.equal(body.service, "employee-voice-nest");
});
