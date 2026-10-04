import "server-only";
import { createSign } from "node:crypto";

// Two ways to act on Google APIs, picked by which env vars are set:
// - GOOGLE_SERVICE_ACCOUNT_JSON: a service account the sheet is shared with.
//   It cannot own Drive files in a personal Gmail Drive, so uploads need a Shared Drive folder.
// - GOOGLE_OAUTH_CLIENT_ID / _SECRET / _REFRESH_TOKEN: acts as the sheet owner (works with Gmail Drive).
const SCOPES = "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive";

let cached: { token: string; expiresAt: number } | null = null;

export function hasGoogleCredentials() {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_OAUTH_REFRESH_TOKEN);
}

function base64url(input: string | Buffer) {
  return Buffer.from(input).toString("base64url");
}

async function exchange(body: URLSearchParams) {
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body, cache: "no-store" });
  const data = await response.json() as { access_token?: string; expires_in?: number; error_description?: string; error?: string };
  if (!response.ok || !data.access_token) throw new Error("Google auth failed: " + (data.error_description || data.error || response.status));
  return { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
}

export async function getAccessToken() {
  if (cached && cached.expiresAt - 60_000 > Date.now()) return cached.token;

  const serviceAccount = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (serviceAccount) {
    const { client_email: email, private_key: key } = JSON.parse(serviceAccount) as { client_email: string; private_key: string };
    const now = Math.floor(Date.now() / 1000);
    const unsigned = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" })) + "." + base64url(JSON.stringify({
      iss: email, scope: SCOPES, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
    }));
    const signature = createSign("RSA-SHA256").update(unsigned).sign(key.replace(/\\n/g, "\n"));
    cached = await exchange(new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: unsigned + "." + base64url(signature),
    }));
    return cached.token;
  }

  const { GOOGLE_OAUTH_CLIENT_ID: clientId, GOOGLE_OAUTH_CLIENT_SECRET: clientSecret, GOOGLE_OAUTH_REFRESH_TOKEN: refreshToken } = process.env;
  if (clientId && clientSecret && refreshToken) {
    cached = await exchange(new URLSearchParams({
      grant_type: "refresh_token", client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken,
    }));
    return cached.token;
  }

  throw new Error("Google credentials are not configured");
}

export async function googleFetch(url: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", "Bearer " + await getAccessToken());
  const response = await fetch(url, { ...init, headers, cache: "no-store" });
  if (!response.ok) throw new Error("Google API " + response.status + ": " + (await response.text()).slice(0, 300));
  return response;
}
