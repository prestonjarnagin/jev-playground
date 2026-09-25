import { createRemoteJWKSet, jwtVerify } from "jose";

export type AccessVerifier = (request: Request, env: Env) => Promise<boolean>;

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1"]);

// Keyed by team domain so the fetched signing keys are reused across requests.
const signingKeysByTeamDomain = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function signingKeysFor(teamDomain: string) {
  let signingKeys = signingKeysByTeamDomain.get(teamDomain);
  if (!signingKeys) {
    signingKeys = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
    signingKeysByTeamDomain.set(teamDomain, signingKeys);
  }
  return signingKeys;
}

/**
 * Cloudflare Access already blocks unauthenticated visitors at the edge. This
 * second check keeps the API from spending money if the Access application is
 * ever removed or misconfigured. `wrangler dev` has no Access in front of it,
 * so local hostnames skip the check; production traffic can't arrive with a
 * localhost Host header because Cloudflare routes on that header.
 */
export const verifyAccessToken: AccessVerifier = async (request, env) => {
  if (LOCAL_HOSTNAMES.has(new URL(request.url).hostname)) return true;

  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token || !env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return false;

  try {
    await jwtVerify(token, signingKeysFor(env.ACCESS_TEAM_DOMAIN), {
      issuer: `https://${env.ACCESS_TEAM_DOMAIN}`,
      audience: env.ACCESS_AUD,
    });
    return true;
  } catch {
    return false;
  }
};
