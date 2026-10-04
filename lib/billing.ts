// Shared between server and browser: no secrets or personal data beyond what a statement shows.
export const MONTHS = [
  "ตุลาคม", "พฤศจิกายน", "ธันวาคม", "มกราคม", "กุมภาพันธ์", "มีนาคม",
  "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน",
] as const;

export type MonthName = (typeof MONTHS)[number];
export type MonthState = "exempt" | "paid" | "pending" | "rejected" | "unpaid";

export type MonthLine = { month: MonthName; state: MonthState; amount: number };

export type HouseholdSummary = { id: string; name: string; houseNo: string; moo: string };

export type Statement = HouseholdSummary & {
  fiscalYear: string;
  subdistrict: string;
  district: string;
  province: string;
  monthlyRate: number;
  months: MonthLine[];
};

export function isDue(state: MonthState) {
  return state === "unpaid" || state === "rejected";
}

// Months must be paid oldest-first: a due month is payable only when every earlier month is
// settled (paid, exempt, awaiting review) or is part of the same payment.
export function isValidSelection(lines: MonthLine[], chosen: readonly string[]) {
  if (!chosen.length || new Set(chosen).size !== chosen.length) return false;
  let reachedGap = false;
  for (const line of lines) {
    const picked = chosen.includes(line.month);
    if (picked && (!isDue(line.state) || reachedGap)) return false;
    if (isDue(line.state) && !picked) reachedGap = true;
  }
  return chosen.every((month) => lines.some((line) => line.month === month));
}

export function selectionTotal(lines: MonthLine[], chosen: readonly string[]) {
  return lines.filter((line) => chosen.includes(line.month)).reduce((sum, line) => sum + line.amount, 0);
}

// Thai fiscal year Y runs from October (Y-1) to September Y, in Buddhist years.
export function currentFiscalYear(now = new Date()) {
  const be = now.getFullYear() + 543;
  return String(now.getMonth() >= 9 ? be + 1 : be);
}
