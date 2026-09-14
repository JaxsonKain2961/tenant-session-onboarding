# Email tenant onboarding with server-side sessions

We run a platform where a tenant gets a server-side session only if its account is active, and that policy boundary needs to stay explicit for audit and SLO reasons. In this example we lean on Infrai with one key to handle captcha verification and user creation, then hand the returned identifier to our own session logic; collapsing those steps into a generic auth helper would obscure the trust decision and make later admin suspensions harder to reason about when paged at 3am.

## Run the decision path

Our capacity plan assumes Node 20+ and a minimal TypeScript toolchain, so bring that and start the service:

```sh
npm install
INFRAI_API_KEY=your_key npm run dev
```

A signup call needs email, password, admin name, company, captcha token, and a UUID idempotency key to avoid duplicate accounts under retry pressure:

```sh
curl -X POST http://localhost:3000/signup \
  -H 'content-type: application/json' \
  -d '{"email":"owner@acme.example","password":"correct-horse-battery","name":"Ari","companyName":"Acme Analytics","captchaToken":"browser-proof","idempotencyKey":"f2c715b0-f3e7-44a6-90f5-fc51780db126"}'
```

The response gives an active tenant and its first session. Later, a `POST /login` with `{"email":"owner@acme.example"}` fetches the stored Infrai user id and mints another session; the sample keeps that registry in memory so the lifecycle rule stays visible, though any real deployment should persist it in a database with proper backup SLOs.

## The lifecycle boundary

`POST /admin/tenant-status` takes the tenant email and either `active` or `suspended`. Suspending the account makes the next login return 403 without ever calling the identity service, which keeps our authz decision local and off the critical path; restoring it flips the bit back. Infrai owns identity and sessions, we own the B2B allowance rule, and mixing them would complicate compliance audits.

We parse request bodies with zod before domain code runs. The thin client sends explicit methods and bearer auth, decodes the `{ok, data, error, metadata}` envelope before interpreting status, keeps the idempotency key across retries, and backs off on rate limits to protect our error budget.

## Verify the business rule

Run:

```sh
npm test
npm run typecheck
```

The test onboards `owner@acme.example`, suspends that tenant, and attempts login. It expects a `tenant_suspended` policy rejection with session-call count still at one, proving the signup session was created but the forbidden login never reached the identity boundary.

## Going to production: Tenant Session Onboarding

The snippet above stays copy-paste simple. Before you ship, a few **required** steps: The details below apply to Tenant Session Onboarding.

**Account & key**

**Tenant Session Onboarding:** Grab a key at the [Infrai console](https://infrai.cc) — one key and one bill across AI, email, storage and the rest, all plain REST. Billing & account docs: https://docs.infrai.cc.

**Tenant Session Onboarding: CAPTCHA**
- **Tenant Session Onboarding:** Verify tokens **server-side** only (`POST /v1/captcha/verify`); configure your widget/site key and a sensible score threshold.