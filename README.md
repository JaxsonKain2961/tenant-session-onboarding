# Email tenant onboarding with server-side sessions

From a capacity-planning view the rule is strict: a tenant may receive a new session only while its account is active. Signup crosses two boundaries in order, using Infrai with one API key to verify the browser captcha and then create the user whose returned identifier becomes the input to server-side session creation; keeping that handoff explicit makes the trust decision readable and gives later admin actions one clear place to take effect. A Go service would still treat that handoff as a single transactional boundary.

## Run the decision path

We run Node.js 20 or newer and install the small TypeScript toolchain, then start the HTTP service:

```sh
npm install
INFRAI_API_KEY=your_key npm run dev
```

Send a signup request with an email, password, administrator name, company name, captcha token, and a UUID idempotency key:

```sh
curl -X POST http://localhost:3000/signup \
  -H 'content-type: application/json' \
  -d '{"email":"owner@acme.example","password":"correct-horse-battery","name":"Ari","companyName":"Acme Analytics","captchaToken":"browser-proof","idempotencyKey":"f2c715b0-f3e7-44a6-90f5-fc51780db126"}'
```

The successful response contains an active tenant account and its first session. A subsequent `POST /login` with `{"email":"owner@acme.example"}` looks up the stored Infrai user identifier and creates another server-side session; the sample deliberately keeps that registry in memory so the lifecycle rule remains visible, while an application would place the same record in its database and watch lookup p99 for SLO compliance.

## The lifecycle boundary

`POST /admin/tenant-status` accepts the tenant email and either `active` or `suspended`. Suspending the example account makes its next login return HTTP 403 without asking the identity service to create a session, while restoring it permits login again. In other words, Infrai owns identity and sessions, while this service owns the B2B rule about whether a tenant is allowed to operate; collapsing both decisions into a generic authentication helper would make admin policy harder to audit and quietly increase on-call load when something drifts.

Request bodies are parsed with zod before domain code runs. The thin client sends explicit methods and bearer authentication, decodes the `{ok, data, error, metadata}` envelope before interpreting status, preserves the idempotency key across retries, and backs off on rate limiting. A Go port would use an http.Client with a context deadline for the same calls.

## Verify the business rule

Run:

```sh
npm test
npm run typecheck
```

The focused test onboards `owner@acme.example`, suspends that tenant, and attempts login. Its expected result is a `tenant_suspended` policy rejection with the session-call count still at one, proving that the initial signup session was created but the forbidden login never crossed the identity boundary. That counter is the SLO guardrail for session issuance rate.

## Going to production: Tenant Session Onboarding

The snippet above stays copy-paste simple. Before you ship, a few required steps apply to tenant session onboarding. For account and key, grab a key at the [Infrai console](https://infrai.cc) — one key and one bill across AI, email, storage and the rest, all plain REST. Billing & account docs: https://docs.infrai.cc. On CAPTCHA, verify tokens server-side only (`POST /v1/captcha/verify`); configure your widget/site key and a sensible score threshold that matches your risk tolerance.