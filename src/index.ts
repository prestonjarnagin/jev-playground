import { type AccessVerifier, verifyAccessToken } from "./access";

const JEV_MODEL = "typesafe/jev";
const MAX_REQUEST_BYTES = 512 * 1024;
const QUESTION_TYPES = new Set(["noul", "choice", "score"]);

type JsonObject = Record<string, unknown>;

interface JevUsage {
  input_tokens: number;
  output_tokens: number;
}

export interface RunStats {
  model: string | null;
  latency_ms: number;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  pricing: { usd_per_million_input_tokens: number; usd_per_million_output_tokens: number };
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export function validateJevInput(body: unknown): string | null {
  if (!isJsonObject(body)) return "Request body must be a JSON object with `state` and `questions`.";
  if (!("state" in body)) return "`state` is required.";
  if (!isJsonObject(body.questions)) return "`questions` must be an object keyed by question id.";

  const questionEntries = Object.entries(body.questions);
  if (questionEntries.length === 0) return "Add at least one question.";

  for (const [questionId, question] of questionEntries) {
    if (!isJsonObject(question)) return `Question \`${questionId}\` must be an object.`;
    if (typeof question.type !== "string" || !QUESTION_TYPES.has(question.type)) {
      return `Question \`${questionId}\` needs a type of noul, choice, or score.`;
    }
  }
  return null;
}

function readUsage(result: JsonObject): JevUsage | null {
  const usage = result.usage;
  if (!isJsonObject(usage)) return null;
  if (typeof usage.input_tokens !== "number" || typeof usage.output_tokens !== "number") return null;
  return { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens };
}

export function buildRunStats(result: JsonObject, latencyMs: number, env: Env): RunStats {
  const usdPerMillionInput = Number(env.JEV_USD_PER_MILLION_INPUT_TOKENS);
  const usdPerMillionOutput = Number(env.JEV_USD_PER_MILLION_OUTPUT_TOKENS);
  const usage = readUsage(result);
  const tokensPerMillion = 1_000_000;

  const costUsd = usage
    ? (usage.input_tokens * usdPerMillionInput + usage.output_tokens * usdPerMillionOutput) / tokensPerMillion
    : null;

  return {
    model: typeof result.model === "string" ? result.model : null,
    latency_ms: Math.round(latencyMs),
    input_tokens: usage?.input_tokens ?? null,
    output_tokens: usage?.output_tokens ?? null,
    cost_usd: costUsd,
    pricing: {
      usd_per_million_input_tokens: usdPerMillionInput,
      usd_per_million_output_tokens: usdPerMillionOutput,
    },
  };
}

/**
 * Requests billed through AI Gateway Unified Billing come back wrapped as
 * `{ state, result, gatewayMetadata }` rather than the bare Jev output the
 * model page documents. Accept both shapes.
 */
export function unwrapJevOutput(response: JsonObject): { output: JsonObject } | { error: string } {
  if (isJsonObject(response.answers)) return { output: response };

  const isEnvelope = "state" in response || "gatewayMetadata" in response;
  if (isEnvelope && isJsonObject(response.result) && isJsonObject(response.result.answers)) {
    return { output: response.result };
  }
  if (isEnvelope) return { error: `Jev did not complete (state: ${String(response.state)}).` };
  return { error: "Jev returned a response with no answers." };
}

async function handleRun(request: Request, env: Env): Promise<Response> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_REQUEST_BYTES) return json({ error: "Request is larger than 512 KB." }, 413);

  const rawBody = await request.text();
  if (rawBody.length > MAX_REQUEST_BYTES) return json({ error: "Request is larger than 512 KB." }, 413);

  let input: unknown;
  try {
    input = JSON.parse(rawBody);
  } catch {
    return json({ error: "Request body is not valid JSON." }, 400);
  }

  const validationError = validateJevInput(input);
  if (validationError || !isJsonObject(input)) {
    return json({ error: validationError ?? "Invalid request." }, 400);
  }

  const startedAt = performance.now();
  try {
    const raw = await env.AI.run(JEV_MODEL, input);
    const latencyMs = performance.now() - startedAt;
    const unwrapped = unwrapJevOutput(raw);

    if ("error" in unwrapped) {
      console.error(JSON.stringify({ event: "jev_run_incomplete", message: unwrapped.error, latency_ms: Math.round(latencyMs) }));
      return json({ error: unwrapped.error, raw, stats: { latency_ms: Math.round(latencyMs) } }, 502);
    }

    const stats = buildRunStats(unwrapped.output, latencyMs, env);
    console.log(JSON.stringify({ event: "jev_run", questions: Object.keys(input.questions as JsonObject).length, ...stats }));
    return json({ result: unwrapped.output, raw, stats });
  } catch (error) {
    const latencyMs = performance.now() - startedAt;
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ event: "jev_run_failed", message, latency_ms: Math.round(latencyMs) }));
    return json({ error: message, stats: { latency_ms: Math.round(latencyMs) } }, 502);
  }
}

export async function handleRequest(
  request: Request,
  env: Env,
  isAuthorized: AccessVerifier = verifyAccessToken,
): Promise<Response> {
  const { pathname } = new URL(request.url);

  if (pathname === "/api/run") {
    if (request.method !== "POST") return json({ error: "Use POST." }, 405);
    if (!(await isAuthorized(request, env))) {
      return json({ error: "Sign in through Cloudflare Access to use this API." }, 401);
    }
    return handleRun(request, env);
  }

  return json({ error: "Not found." }, 404);
}

export default {
  fetch: (request, env) => handleRequest(request, env),
} satisfies ExportedHandler<Env>;
