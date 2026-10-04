import { NextResponse } from "next/server";
import { currentFiscalYear } from "@/lib/billing";
import { fiscalYears } from "@/lib/server/households";

export async function GET() {
  const years = await fiscalYears();
  const current = currentFiscalYear();
  return NextResponse.json({ years, current: years.includes(current) ? current : years[0] ?? current });
}
