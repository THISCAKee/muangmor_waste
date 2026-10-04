import "server-only";
import { googleFetch, hasGoogleCredentials } from "@/lib/server/google";

export const SHEET_ID = process.env.SHEET_ID || "1bAZvd9MfcUliVfUaQzxcLUNnEgyiF8Er4knQjW_KslY";

// gids are only needed for the public CSV fallback used before credentials are set up.
const PUBLIC_GIDS: Record<string, string> = { payment_DATA: "1386500049", slip: "1854703049" };
const TTL_MS = 60_000;

export type Table = { header: string[]; rows: string[][] };
const cache = new Map<string, { at: number; table: Table }>();

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

async function fetchTable(tab: string): Promise<string[][]> {
  if (hasGoogleCredentials()) {
    const url = "https://sheets.googleapis.com/v4/spreadsheets/" + SHEET_ID + "/values/" + encodeURIComponent(tab) + "?valueRenderOption=FORMATTED_VALUE";
    const data = await (await googleFetch(url)).json() as { values?: string[][] };
    return data.values ?? [];
  }
  const gid = PUBLIC_GIDS[tab];
  if (!gid) throw new Error("No public gid for tab " + tab);
  const response = await fetch("https://docs.google.com/spreadsheets/d/" + SHEET_ID + "/export?format=csv&gid=" + gid, { cache: "no-store" });
  if (!response.ok) throw new Error("Sheet export " + response.status + " (is the sheet still shared publicly?)");
  return parseCsv(await response.text());
}

export async function readTable(tab: string, { fresh = false } = {}): Promise<Table> {
  const hit = cache.get(tab);
  if (!fresh && hit && Date.now() - hit.at < TTL_MS) return hit.table;
  const [header = [], ...rows] = await fetchTable(tab);
  const table = { header: header.map((name) => name.trim()), rows };
  cache.set(tab, { at: Date.now(), table });
  return table;
}

export function column(table: Table, name: string) {
  const index = table.header.indexOf(name);
  return (row: string[]) => (index < 0 ? "" : (row[index] ?? "").trim());
}

// Appends one row, placing each value under the header with the same name so column order in the sheet can change.
// Columns listed in `optional` are written only when the sheet has them.
export async function appendRecord(tab: string, record: Record<string, string>, optional: string[] = []) {
  if (!hasGoogleCredentials()) throw new Error("Writing needs Google credentials");
  const { header } = await readTable(tab, { fresh: true });
  const missing = Object.keys(record).filter((name) => !header.includes(name) && !optional.includes(name));
  if (missing.length) throw new Error("Sheet " + tab + " is missing columns: " + missing.join(", "));
  const row = header.map((name) => record[name] ?? "");
  const url = "https://sheets.googleapis.com/v4/spreadsheets/" + SHEET_ID + "/values/" + encodeURIComponent(tab)
    + ":append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS";
  await googleFetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ values: [row] }) });
  cache.delete(tab);
}
