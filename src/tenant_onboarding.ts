import { createServer, type ServerResponse } from "node:http";
import { z, ZodError } from "zod";
import { InfraiClient, InfraiError } from "./infrai_client.js";
import { TenantPolicyError, TenantService } from "./tenant_service.js";

type SignupBody = {
  email: string;
  password: string;
  name: string;
  companyName: string;
  captchaToken: string;
  idempotencyKey: string;
};

type LoginBody = { email: string };

const signupBody = z.object({
  email: z.string().email(),
  password: z.string().min(12),
  name: z.string().min(1),
  companyName: z.string().min(1),
  captchaToken: z.string().min(1),
  idempotencyKey: z.string().uuid(),
});
const loginBody = z.object({ email: z.string().email() });
const statusBody = z.object({
  email: z.string().email(),
  status: z.enum(["active", "suspended"]),
});

const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service");
const tenants = new TenantService(new InfraiClient(apiKey));

async function readJson(request: AsyncIterable<Uint8Array>) {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function send(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(value));
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === "POST" && request.url === "/signup") {
      const body = signupBody.parse(await readJson(request)) as SignupBody;
      return send(response, 201, await tenants.onboard(body));
    }
    if (request.method === "POST" && request.url === "/login") {
      const body = loginBody.parse(await readJson(request)) as LoginBody;
      return send(response, 200, await tenants.login(body));
    }
    if (request.method === "POST" && request.url === "/admin/tenant-status") {
      const body = statusBody.parse(await readJson(request));
      return send(response, 200, tenants.setStatus(body.email, body.status));
    }
    return send(response, 404, { error: "route_not_found" });
  } catch (error) {
    if (error instanceof ZodError) return send(response, 400, { error: "invalid_request", details: error.issues });
    if (error instanceof TenantPolicyError) return send(response, error.reason === "unknown_account" ? 404 : 403, { error: error.reason });
    if (error instanceof InfraiError) return send(response, error.status >= 400 && error.status < 500 ? error.status : 502, { error: error.code });
    return send(response, 500, { error: "service_error" });
  }
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => console.log(`Tenant auth service listening on http://localhost:${port}`));
