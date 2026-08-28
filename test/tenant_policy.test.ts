import assert from "node:assert/strict";
import test from "node:test";
import type { IdentityGateway } from "../src/infrai_client.js";
import { TenantPolicyError, TenantService } from "../src/tenant_service.js";

test("a suspended tenant cannot open another server-side session", async () => {
  let sessionCalls = 0;
  const identity: IdentityGateway = {
    async verifyCaptcha() { return {}; },
    async createUser() { return { id: "user_42" }; },
    async createSession() {
      sessionCalls += 1;
      return { session_id: `session_${sessionCalls}` };
    },
  };
  const service = new TenantService(identity);
  await service.onboard({
    email: "owner@acme.example",
    password: "correct-horse-battery",
    name: "Ari",
    companyName: "Acme Analytics",
    captchaToken: "browser-proof",
    idempotencyKey: "f2c715b0-f3e7-44a6-90f5-fc51780db126",
  });
  service.setStatus("owner@acme.example", "suspended");

  await assert.rejects(
    service.login({ email: "owner@acme.example" }),
    (error) => error instanceof TenantPolicyError && error.reason === "tenant_suspended",
  );
  assert.equal(sessionCalls, 1);
});
