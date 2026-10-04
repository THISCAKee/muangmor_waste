import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { isValidSelection, selectionTotal } from "@/lib/billing";
import { getStatement } from "@/lib/server/households";
import { billConfig, billPayment, encodeRef2 } from "@/lib/server/ktb-bill";
import { createOrderToken, newReference } from "@/lib/server/order-token";
import { MIN_BANK_AMOUNT, paymentProvider } from "@/lib/server/payments";
import { promptPayPayload } from "@/lib/server/promptpay";

// Locks the amount: months and total come from the sheet, never from the browser.
export async function POST(request: Request) {
  const { householdId, months } = await request.json() as { householdId?: string; months?: string[] };
  if (typeof householdId !== "string" || !Array.isArray(months)) return NextResponse.json({ error: "ข้อมูลไม่ครบ" }, { status: 400 });

  const statement = await getStatement(householdId, { fresh: true });
  if (!statement) return NextResponse.json({ error: "ไม่พบข้อมูลบ้านนี้" }, { status: 404 });
  if (!isValidSelection(statement.months, months)) {
    return NextResponse.json({ error: "เดือนที่เลือกไม่ถูกต้อง หรือสถานะเปลี่ยนไปแล้ว กรุณาโหลดหน้าใหม่" }, { status: 409 });
  }

  const amount = selectionTotal(statement.months, months);
  const ordered = statement.months.map((line) => line.month).filter((month) => months.includes(month));
  // With Krungthai bill payment the order reference is Ref2, so a bank report can be matched back to it.
  const ref = billConfig() ? encodeRef2(ordered) : newReference();
  const token = createOrderToken({ householdId, months: ordered, amount, ref });

  const ktb = await billPayment({ householdId, months: ordered, amount, ref2: ref });
  const promptPayId = process.env.PROMPTPAY_ID;
  const qr = !ktb && promptPayId ? await QRCode.toDataURL(promptPayPayload(promptPayId, amount), { margin: 1, width: 560 }) : null;

  return NextResponse.json({
    token, ref, amount, months: ordered, qr, ktb,
    payee: process.env.PAYEE_NAME || null,
    bankApp: Boolean(paymentProvider()) && amount >= MIN_BANK_AMOUNT,
  });
}
