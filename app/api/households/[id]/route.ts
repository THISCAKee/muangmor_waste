import { NextResponse } from "next/server";
import { getStatement } from "@/lib/server/households";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const statement = await getStatement(decodeURIComponent((await params).id));
  if (!statement) return NextResponse.json({ error: "ไม่พบข้อมูลบ้านนี้" }, { status: 404 });
  return NextResponse.json(statement);
}
