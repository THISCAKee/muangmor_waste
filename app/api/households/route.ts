import { NextResponse, type NextRequest } from "next/server";
import { searchHouseholds } from "@/lib/server/households";

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q") ?? "";
  const year = request.nextUrl.searchParams.get("year") ?? "";
  if (!/^\d{4}$/.test(year) || q.length > 60) return NextResponse.json({ error: "คำค้นไม่ถูกต้อง" }, { status: 400 });
  return NextResponse.json({ results: await searchHouseholds(q, year) });
}
