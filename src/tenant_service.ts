import { randomUUID } from "node:crypto";
import type { IdentityGateway } from "./infrai_client.js";

export type TenantStatus = "active" | "suspended";

export type TenantAccount = {
  tenantId: string;
  userId: string;
  email: string;
  companyName: string;
  status: TenantStatus;
};

export class TenantPolicyError extends Error {
  readonly reason: "unknown_account" | "tenant_suspended";

  constructor(reason: "unknown_account" | "tenant_suspended") {
    super(reason);
    this.reason = reason;
  }
}

export class TenantService {
  private readonly accounts = new Map<string, TenantAccount>();
  private readonly identity: IdentityGateway;

  constructor(identity: IdentityGateway) {
    this.identity = identity;
  }

  async onboard(input: {
    email: string;
    password: string;
    name: string;
    companyName: string;
    captchaToken: string;
    idempotencyKey: string;
  }) {
    await this.identity.verifyCaptcha({
      widget_record_id: "tenant_signup",
      token: input.captchaToken,
    });
    const tenantId = randomUUID();
    const user = await this.identity.createUser({
      email: input.email,
      password: input.password,
      name: input.name,
      metadata: { tenantId, companyName: input.companyName, role: "admin" },
      idempotency_key: input.idempotencyKey,
    });
    const account: TenantAccount = {
      tenantId,
      userId: user.id,
      email: input.email,
      companyName: input.companyName,
      status: "active",
    };
    this.accounts.set(input.email, account);
    const session = await this.identity.createSession({
      user_id: user.id,
      method: "password",
      require_mfa: false,
    });
    return { account, session };
  }

  async login(input: { email: string }) {
    const account = this.accounts.get(input.email);
    if (!account) throw new TenantPolicyError("unknown_account");
    if (account.status === "suspended") {
      throw new TenantPolicyError("tenant_suspended");
    }
    const session = await this.identity.createSession({
      user_id: account.userId,
      method: "password",
      require_mfa: false,
    });
    return { account, session };
  }

  setStatus(email: string, status: TenantStatus): TenantAccount {
    const account = this.accounts.get(email);
    if (!account) throw new TenantPolicyError("unknown_account");
    const updated = { ...account, status };
    this.accounts.set(email, updated);
    return updated;
  }
}
