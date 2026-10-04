import "server-only";
import { MONTHS, type HouseholdSummary, type MonthLine, type MonthState, type Statement } from "@/lib/billing";
import { column, readTable, type Table } from "@/lib/server/sheets";

const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
const amount = (value: string) => Number(value.replace(/[^\d.-]/g, "")) || 0;

type SlipMark = { state: "pending" | "verified" | "rejected" };

// Status written by staff in AppSheet: ✅ means verified; anything marked as refused is rejected; blank is waiting.
function slipState(status: string): SlipMark["state"] {
  if (status.includes("✅")) return "verified";
  if (/❌|ไม่ผ่าน|ปฏิเสธ|ส่งกลับ/.test(status)) return "rejected";
  return "pending";
}

// The slip sheet links to a payer by name only (plus key/house number when the column exists),
// so the latest slip for a name + fiscal year + month wins, as in the original site.
async function slipMarks(fresh: boolean) {
  const table = await readTable("slip", { fresh });
  const name = column(table, "ชื่อผู้โอน");
  const months = column(table, "เดือนที่ชำระ");
  const year = column(table, "ประจำปี");
  const status = column(table, "สถานะ");
  const householdKey = column(table, "keyลูกค้า");
  const marks = new Map<string, SlipMark>();
  for (const row of table.rows) {
    const who = householdKey(row) || normalize(name(row));
    if (!who) continue;
    for (const month of months(row).split(",").map((m) => m.trim()).filter(Boolean)) {
      marks.set(who + "|" + year(row) + "|" + month, { state: slipState(status(row)) });
    }
  }
  return marks;
}

function readers(table: Table) {
  const get = (name: string) => column(table, name);
  return {
    key: get("key"), year: get("ประจำปี"), name: get("ชื่อ-สกุล/บริษัท"), houseNo: get("บ้านเลขที่"), moo: get("หมู่ที่"),
    subdistrict: get("ตำบล"), district: get("อำเภอ"), province: get("จังหวัด"), rate: get("อัตรา/เดือน"),
    startMonth: get("เดือนที่เริ่มชำระ"), startYear: get("ปีที่เริ่มชำระ"),
    paid: (m: string) => get(m), due: (m: string) => get(m + "ที่ต้องจ่าย"), note: (m: string) => get(m + "หมายเหตุ"),
  };
}

const householdId = (key: string, year: string) => key + "-" + year;

export async function fiscalYears() {
  const table = await readTable("payment_DATA");
  const r = readers(table);
  return [...new Set(table.rows.map(r.year).filter((y) => /^\d{4}$/.test(y)))].sort((a, b) => Number(b) - Number(a));
}

export async function searchHouseholds(query: string, year: string): Promise<HouseholdSummary[]> {
  const term = normalize(query).toLocaleLowerCase("th-TH");
  if (term.length < 2 && !/^\d/.test(term)) return [];
  const table = await readTable("payment_DATA");
  const r = readers(table);
  const matches = table.rows.filter((row) => r.year(row) === year && r.key(row)).map((row) => ({
    id: householdId(r.key(row), year), name: normalize(r.name(row)), houseNo: r.houseNo(row), moo: r.moo(row),
  })).filter((h) => h.name.toLocaleLowerCase("th-TH").includes(term) || h.houseNo === term || h.houseNo.startsWith(term + "/"));
  // Exact house-number hits first, then by name.
  matches.sort((a, b) => Number(b.houseNo === term) - Number(a.houseNo === term) || a.name.localeCompare(b.name, "th"));
  return matches.slice(0, 30);
}

const monthIndex = (name: string) => MONTHS.indexOf(name as (typeof MONTHS)[number]);

export async function getStatement(id: string, { fresh = false } = {}): Promise<Statement | null> {
  const match = /^(.+)-(\d{4})$/.exec(id);
  if (!match) return null;
  const [, key, year] = match;
  // `fresh` only bypasses the cache for slips: that is what changes between a page load and a payment.
  const table = await readTable("payment_DATA");
  const r = readers(table);
  const row = table.rows.find((candidate) => r.key(candidate) === key && r.year(candidate) === year);
  if (!row) return null;

  const marks = await slipMarks(fresh);
  const name = normalize(r.name(row));
  const rate = amount(r.rate(row));
  const startIdx = monthIndex(r.startMonth(row));
  const startYear = Number(r.startYear(row)) || 0;

  const months: MonthLine[] = MONTHS.map((month, index) => {
    const dueText = r.due(month)(row);
    const due = dueText === "" ? rate : amount(dueText);
    const calendarYear = index < 3 ? Number(year) - 1 : Number(year);
    const calendarMonth = (index + 9) % 12; // 0 = January
    const startCalendarMonth = startIdx < 0 ? -1 : (startIdx + 9) % 12;
    const beforeStart = startIdx >= 0 && startYear > 0
      && (calendarYear < startYear || (calendarYear === startYear && calendarMonth < startCalendarMonth));

    let state: MonthState;
    if (beforeStart || r.note(month)(row).includes("ยกเว้น") || due <= 0) state = "exempt";
    else if (amount(r.paid(month)(row)) > 0) state = "paid";
    else {
      const mark = marks.get(key + "|" + year + "|" + month) ?? marks.get(name + "|" + year + "|" + month);
      state = mark?.state === "verified" ? "paid" : mark?.state === "pending" ? "pending" : mark?.state === "rejected" ? "rejected" : "unpaid";
    }
    return { month, state, amount: state === "exempt" ? 0 : due };
  });

  return {
    id, name, houseNo: r.houseNo(row), moo: r.moo(row), fiscalYear: year,
    subdistrict: r.subdistrict(row), district: r.district(row), province: r.province(row),
    monthlyRate: rate, months,
  };
}
