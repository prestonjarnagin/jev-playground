import { describe, expect, it, vi } from "vitest";
import { buildRunStats, handleRequest as handleRequestWithAccess, validateJevInput } from "../src/index";

const allowAll = async () => true;
const handleRequest = (request: Request, env: Env) => handleRequestWithAccess(request, env, allowAll);

const JEV_RESULT = {
  model: "jev-1.13.0",
  answers: { is_urgent: { type: "noul", noul: 0.95 } },
  usage: { input_tokens: 2_000_000, output_tokens: 73 },
};

function makeEnv(run: (model: string, input: unknown) => Promise<unknown>): Env {
  return {
    AI: { run: vi.fn(run) },
    JEV_USD_PER_MILLION_INPUT_TOKENS: "0.042",
    JEV_USD_PER_MILLION_OUTPUT_TOKENS: "0",
  } as unknown as Env;
}

function postRun(body: string): Request {
  return new Request("https://jev.prestonj.com/api/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

const validInput = {
  state: "Help! My payouts have been failing for 3 days.",
  questions: { is_urgent: { type: "noul", instructions: "Does this convey urgency?" } },
};

describe("POST /api/run", () => {
  it("forwards the input to typesafe/jev and returns the result with stats", async () => {
    const env = makeEnv(async () => JEV_RESULT);
    const response = await handleRequest(postRun(JSON.stringify(validInput)), env);
    const payload = (await response.json()) as { result: unknown; stats: Record<string, unknown> };

    expect(response.status).toBe(200);
    expect(env.AI.run).toHaveBeenCalledWith("typesafe/jev", validInput);
    expect(payload.result).toEqual(JEV_RESULT);
    expect(payload.stats).toMatchObject({ model: "jev-1.13.0", input_tokens: 2_000_000, output_tokens: 73 });
    expect(payload.stats.cost_usd).toBeCloseTo(0.084);
  });

  it("unwraps the Unified Billing envelope for stats and keeps the envelope as the raw response", async () => {
    const envelope = { state: "Completed", result: JEV_RESULT, gatewayMetadata: { keySource: "Unified" } };
    const env = makeEnv(async () => envelope);
    const response = await handleRequest(postRun(JSON.stringify(validInput)), env);
    const payload = (await response.json()) as { result: unknown; raw: unknown; stats: Record<string, unknown> };

    expect(response.status).toBe(200);
    expect(payload.result).toEqual(JEV_RESULT);
    expect(payload.raw).toEqual(envelope);
    expect(payload.stats).toMatchObject({ model: "jev-1.13.0", input_tokens: 2_000_000, output_tokens: 73 });
  });

  it("reports an envelope that never completed as a 502", async () => {
    const env = makeEnv(async () => ({ state: "Failed", result: {}, gatewayMetadata: {} }));
    const response = await handleRequest(postRun(JSON.stringify(validInput)), env);
    const payload = (await response.json()) as { error: string; raw: unknown };

    expect(response.status).toBe(502);
    expect(payload.error).toContain("Failed");
    expect(payload.raw).toMatchObject({ state: "Failed" });
  });

  it("rejects invalid JSON and malformed questions without calling the model", async () => {
    const env = makeEnv(async () => JEV_RESULT);

    const badJson = await handleRequest(postRun("{nope"), env);
    expect(badJson.status).toBe(400);

    const badType = await handleRequest(
      postRun(JSON.stringify({ state: "s", questions: { q: { type: "maybe", instructions: "?" } } })), env);
    expect(badType.status).toBe(400);
    expect(env.AI.run).not.toHaveBeenCalled();
  });

  it("rejects bodies over 512 KB", async () => {
    const env = makeEnv(async () => JEV_RESULT);
    const oversized = JSON.stringify({ ...validInput, state: "x".repeat(600 * 1024) });
    const response = await handleRequest(postRun(oversized), env);
    expect(response.status).toBe(413);
  });

  it("returns the model error message as a 502", async () => {
    const env = makeEnv(async () => {
      throw new Error("5006: questions.q.criteria must have at least 2 items");
    });
    const response = await handleRequest(postRun(JSON.stringify(validInput)), env);
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(502);
    expect(payload.error).toContain("at least 2 items");
  });

  it("only accepts POST and only serves /api/run", async () => {
    const env = makeEnv(async () => JEV_RESULT);
    const get = await handleRequest(new Request("https://jev.prestonj.com/api/run"), env);
    expect(get.status).toBe(405);

    const other = await handleRequest(new Request("https://jev.prestonj.com/api/other"), env);
    expect(other.status).toBe(404);
  });
});

describe("Access gate", () => {
  it("returns 401 without calling the model when the Access check fails", async () => {
    const env = makeEnv(async () => JEV_RESULT);
    const response = await handleRequestWithAccess(postRun(JSON.stringify(validInput)), env, async () => false);

    expect(response.status).toBe(401);
    expect(env.AI.run).not.toHaveBeenCalled();
  });
});

describe("validateJevInput", () => {
  it("requires state and at least one question", () => {
    expect(validateJevInput({ questions: { q: { type: "noul" } } })).toMatch(/state/);
    expect(validateJevInput({ state: "s", questions: {} })).toMatch(/at least one/);
    expect(validateJevInput({ state: null, questions: { q: { type: "score" } } })).toBeNull();
  });
});

describe("buildRunStats", () => {
  it("leaves tokens and cost empty when the result has no usage", () => {
    const env = makeEnv(async () => ({}));
    expect(buildRunStats({ answers: {} }, 12.4, env)).toMatchObject({
      model: null,
      latency_ms: 12,
      input_tokens: null,
      cost_usd: null,
    });
  });
});
