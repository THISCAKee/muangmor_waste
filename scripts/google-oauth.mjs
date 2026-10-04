// One-time helper: sign in as the sheet owner and print a refresh token for GOOGLE_OAUTH_REFRESH_TOKEN.
// Usage: GOOGLE_OAUTH_CLIENT_ID=... GOOGLE_OAUTH_CLIENT_SECRET=... node scripts/google-oauth.mjs
// The OAuth client must be type "Desktop app" in Google Cloud Console.
import { createServer } from "node:http";

const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error("Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET first.");
  process.exit(1);
}

const port = 53682;
const redirectUri = "http://127.0.0.1:" + port;
const scope = "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive";
const authUrl = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
  client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope, access_type: "offline", prompt: "consent",
});

createServer(async (request, response) => {
  const code = new URL(request.url, redirectUri).searchParams.get("code");
  if (!code) { response.end("No code"); return; }
  const tokens = await (await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
  })).json();
  response.end(tokens.refresh_token ? "Done. Return to the terminal." : "Failed: " + JSON.stringify(tokens));
  console.log(tokens.refresh_token ? "\nGOOGLE_OAUTH_REFRESH_TOKEN=" + tokens.refresh_token + "\n" : tokens);
  process.exit(0);
}).listen(port, () => console.log("Open this URL and sign in with the account that owns the sheet:\n\n" + authUrl + "\n"));
