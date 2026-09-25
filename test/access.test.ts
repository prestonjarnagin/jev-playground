import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { verifyAccessToken } from "../src/access";

const TEAM_DOMAIN = "prestonj.cloudflareaccess.com";
const AUD = "test-audience-tag";

const env = { ACCESS_TEAM_DOMAIN: TEAM_DOMAIN, ACCESS_AUD: AUD } as unknown as Env;

let privateKey: CryptoKey;
let publicJwk: JsonWebKey;

beforeAll(async () => {
  const keyPair = await generateKeyPair("RS256");
  privateKey = keyPair.privateKey;
  publicJwk = { ...(await exportJWK(keyPair.publicKey)), kid: "test-key", alg: "RS256" } as JsonWebKey;
});

afterEach(() => vi.unstubAllGlobals());

function serveSigningKeys() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL | string) => {
      expect(String(url)).toBe(`https://${TEAM_DOMAIN}/cdn-cgi/access/certs`);
      return Response.json({ keys: [publicJwk] });
    }),
  );
}

function signAccessToken(claims: { issuer?: string; audience?: string } = {}) {
  return new SignJWT({ email: "someone@example.com" })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(claims.issuer ?? `https://${TEAM_DOMAIN}`)
    .setAudience(claims.audience ?? AUD)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
}

function requestWithToken(token?: string, host = "jev.prestonj.com") {
  const headers = new Headers();
  if (token) headers.set("cf-access-jwt-assertion", token);
  return new Request(`https://${host}/api/run`, { method: "POST", headers });
}

describe("verifyAccessToken", () => {
  it("accepts a token signed by the team's Access keys for this application", async () => {
    serveSigningKeys();
    expect(await verifyAccessToken(requestWithToken(await signAccessToken()), env)).toBe(true);
  });

  it("rejects a token issued for a different application", async () => {
    serveSigningKeys();
    const token = await signAccessToken({ audience: "some-other-app" });
    expect(await verifyAccessToken(requestWithToken(token), env)).toBe(false);
  });

  it("rejects a token from a different team", async () => {
    serveSigningKeys();
    const token = await signAccessToken({ issuer: "https://someone-else.cloudflareaccess.com" });
    expect(await verifyAccessToken(requestWithToken(token), env)).toBe(false);
  });

  it("rejects requests with no token", async () => {
    expect(await verifyAccessToken(requestWithToken(), env)).toBe(false);
  });

  it("fails closed when the Access settings are not configured", async () => {
    const unconfigured = { ACCESS_TEAM_DOMAIN: "", ACCESS_AUD: "" } as unknown as Env;
    expect(await verifyAccessToken(requestWithToken("anything"), unconfigured)).toBe(false);
  });

  it("skips the check for wrangler dev on localhost", async () => {
    expect(await verifyAccessToken(requestWithToken(undefined, "localhost:8787"), env)).toBe(true);
  });
});
