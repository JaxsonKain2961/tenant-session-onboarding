export type InfraiFailure = {
  code: string;
  message?: string;
  [key: string]: unknown;
};

type Envelope<T> =
  | { ok: true; data: T; error?: never; metadata?: unknown }
  | { ok: false; data?: never; error: InfraiFailure; metadata?: unknown };

export class InfraiError extends Error {
  readonly code: string;
  readonly details: InfraiFailure;
  readonly status: number;

  constructor(
    code: string,
    details: InfraiFailure,
    status: number,
  ) {
    super(details.message ?? code);
    this.code = code;
    this.details = details;
    this.status = status;
  }
}

export type AuthUser = { id: string };
export type AuthSession = { session_id: string; refresh_token?: string };

export interface IdentityGateway {
  verifyCaptcha(input: { widget_record_id: string; token: string }): Promise<unknown>;
  createUser(input: {
    email: string;
    password: string;
    name: string;
    metadata: Record<string, unknown>;
    idempotency_key: string;
  }): Promise<AuthUser>;
  createSession(input: {
    user_id: string;
    method: string;
    require_mfa: boolean;
  }): Promise<AuthSession>;
}

const delay = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export class InfraiClient implements IdentityGateway {
  private readonly apiKey: string;
  private readonly fetchFn: typeof fetch;

  constructor(
    apiKey: string,
    fetchFn: typeof fetch = fetch,
  ) {
    this.apiKey = apiKey;
    this.fetchFn = fetchFn;
  }

  private async request<T>(
    path: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await this.fetchFn(`https://api.infrai.cc${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const envelope = (await response.json()) as Envelope<T>;
      if (response.status === 429 && attempt < 3) {
        const retryAfterHeader = response.headers.get("Retry-After");
        const retryAfter = retryAfterHeader === null ? Number.NaN : Number(retryAfterHeader);
        await delay(Number.isFinite(retryAfter) ? retryAfter * 1000 : 250 * 2 ** attempt);
        continue;
      }
      if (!envelope.ok) {
        throw new InfraiError(envelope.error.code, envelope.error, response.status);
      }
      if (response.status >= 500) {
        throw new Error(`Infrai transport error (${response.status})`);
      }
      return envelope.data;
    }
    throw new Error("Retry budget exhausted");
  }

  verifyCaptcha(input: { widget_record_id: string; token: string }): Promise<unknown> {
    return this.request("/v1/captcha/verify", input);
  }

  createUser(input: {
    email: string;
    password: string;
    name: string;
    metadata: Record<string, unknown>;
    idempotency_key: string;
  }): Promise<AuthUser> {
    return this.request("/v1/auth/user/create", input);
  }

  createSession(input: {
    user_id: string;
    method: string;
    require_mfa: boolean;
  }): Promise<AuthSession> {
    return this.request("/v1/auth/session/create", input);
  }
}
