import { NextResponse } from "next/server";
import { isBankId } from "@/lib/banks";
import { isValidSelection, selectionTotal } from "@/lib/billing";
import { getStatement } from "@/lib/server/households";
import { readOrderToken } from "@/lib/server/order-token";
import { createBankCharge, MIN_BANK_AMOUNT, paymentProvider } from "@/lib/server/payments";

const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });

// Starts a bank-app payment for a locked order and returns the URL that opens the chosen bank's app.
export async function POST(request: Request) {
  const { token, bank, platform } = await request.json() as { token?: string; bank?: string; platform?: string };
  if (!paymentProvider()) return fail("ยังไม่เปิดให้ชำระผ่านแอปธนาคาร", 503);
  const order = typeof token === "string" ? readOrderToken(token) : null;
  if (!order) return fail("รายการชำระหมดอายุ กรุณาเลือกเดือนแล้วกดชำระใหม่", 410);
  if (!isBankId(bank)) return fail("เลือกธนาคารก่อน");
  if (platform !== "IOS" && platform !== "ANDROID") return fail("การเปิดแอปธนาคารใช้ได้บนมือถือเท่านั้น");
  if (order.amount < MIN_BANK_AMOUNT) return fail("ยอดต่ำกว่า " + MIN_BANK_AMOUNT + " บาท กรุณาชำระด้วย QR พร้อมเพย์");

  const statement = await getStatement(order.householdId, { fresh: true });
  if (!statement) return fail("ไม่พบข้อมูลบ้านนี้", 404);
  if (!isValidSelection(statement.months, order.months) || selectionTotal(statement.months, order.months) !== order.amount) {
    return fail("เดือนนี้มีการชำระหรือส่งหลักฐานแล้ว กรุณาโหลดหน้าใหม่", 409);
  }

  const origin = process.env.PUBLIC_URL || new URL(request.url).origin;
  const returnUri = origin + "/?" + new URLSearchParams({ payment: order.ref, h: order.householdId });
  try {
    const charge = await createBankCharge({
      bank, platform, returnUri,
      meta: { householdId: order.householdId, months: order.months, amount: order.amount, ref: order.ref, payerName: statement.name, fiscalYear: statement.fiscalYear },
    });
    return NextResponse.json(charge);
  } catch (error) {
    console.error("create charge failed", error);
    return fail("เชื่อมต่อธนาคารไม่สำเร็จ กรุณาลองใหม่ หรือใช้ QR พร้อมเพย์", 502);
  }
}
