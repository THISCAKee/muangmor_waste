import "server-only";
import { appendRecord, column, readTable } from "@/lib/server/sheets";

const THAI_MONTHS = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];

function bangkokNow() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit", hour: "numeric", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  return { day: Number(parts.day), month: Number(parts.month), year: Number(parts.year), time: parts.hour + ":" + parts.minute + ":" + parts.second, date: parts.day + "/" + parts.month + "/" + parts.year };
}

export type SlipEntry = {
  householdId: string;
  ref: string;
  payerName: string;
  fiscalYear: string;
  months: string[];
  amount: number;
  phone: string;
  evidence: string;    // Drive link for an uploaded slip, or the gateway charge ID for an online payment
  picture?: string;
  status: string;      // "" waits for staff in AppSheet; text containing ✅ counts as verified
};

// Rows whose evidence column already holds this text (used to avoid recording one charge twice).
export async function slipExists(evidenceFragment: string) {
  const slips = await readTable("slip", { fresh: true });
  const evidence = column(slips, "หลักฐานการโอน");
  return slips.rows.some((row) => evidence(row).includes(evidenceFragment));
}

export async function appendSlip(entry: SlipEntry) {
  const now = bangkokNow();
  const slips = await readTable("slip", { fresh: true });
  const keyOf = column(slips, "key");
  const nextKey = slips.rows.reduce((max, row) => Math.max(max, Number(keyOf(row)) || 0), 0) + 1;
  const beYear = now.year + 543;

  await appendRecord("slip", {
    "key": String(nextKey),
    "วันที่": now.date,
    "เวลา": now.time,
    "ชื่อผู้โอน": entry.payerName,
    "เบอร์ติดต่อ": entry.phone ? "'" + entry.phone : "",
    "เดือนที่ชำระ": entry.months.join(","),
    "จำนวนเงิน": String(entry.amount),
    "หลักฐานการโอน": entry.evidence,
    "ประจำปี": entry.fiscalYear,
    "สถานะ": entry.status,
    "PICSLIP": entry.picture ?? "",
    "วัน": String(now.day),
    "เดือน": THAI_MONTHS[now.month - 1],
    "ปี": String(beYear),
    "วัน/เดือน/ปี": now.day + " " + THAI_MONTHS[now.month - 1] + " " + beYear,
    "keyลูกค้า": entry.householdId.replace(/-\d{4}$/, ""),
    "เลขอ้างอิง": entry.ref,
  }, ["keyลูกค้า", "เลขอ้างอิง", "PICSLIP", "วัน", "เดือน", "ปี", "วัน/เดือน/ปี"]);
}
