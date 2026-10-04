import { NextResponse } from "next/server";
import { getCharge, recordCharge } from "@/lib/server/payments";

// Called by the page the bank app returns to. The charge is re-read from the gateway, so the browser cannot fake a payment.
export async function POST(request: Request) {
  const { chargeId } = await request.json() as { chargeId?: string };
  const charge = typeof chargeId === "string" ? await getCharge(chargeId) : null;
  if (!charge) return NextResponse.json({ error: "ไม่พบรายการชำระ" }, { status: 404 });
  try {
    const result = await recordCharge(charge);
    return NextResponse.json({ ...result, ref: charge.meta.ref, months: charge.meta.months, amount: charge.meta.amount });
  } catch (error) {
    console.error("record charge failed", error);
    return NextResponse.json({ error: "ชำระเงินแล้วแต่บันทึกไม่สำเร็จ เจ้าหน้าที่จะตรวจสอบให้ เลขอ้างอิง " + charge.meta.ref }, { status: 503 });
  }
}
