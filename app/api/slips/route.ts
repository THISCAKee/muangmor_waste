import { NextResponse } from "next/server";
import { isValidSelection, selectionTotal, type Statement } from "@/lib/billing";
import { uploadToDrive } from "@/lib/server/drive";
import { getStatement } from "@/lib/server/households";
import { readOrderToken, type Order } from "@/lib/server/order-token";
import { appendSlip } from "@/lib/server/slip-sheet";

const MAX_BYTES = 4 * 1024 * 1024;

function imageType(bytes: Buffer) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: "image/png", ext: "png" };
  if (bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP") return { mime: "image/webp", ext: "webp" };
  return null;
}

const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function POST(request: Request) {
  const form = await request.formData();
  const token = form.get("token");
  const phone = String(form.get("phone") ?? "").replace(/[-\s]/g, "");
  const file = form.get("file");

  const order = typeof token === "string" ? readOrderToken(token) : null;
  if (!order) return fail("รายการชำระหมดอายุ กรุณาเลือกเดือนแล้วกดชำระใหม่", 410);
  if (!/^0\d{9}$/.test(phone)) return fail("กรอกเบอร์โทรศัพท์มือถือ 10 หลักให้ถูกต้อง");
  if (!(file instanceof File) || file.size === 0) return fail("แนบรูปสลิปก่อนส่ง");
  if (file.size > MAX_BYTES) return fail("ไฟล์ใหญ่เกิน 4 MB");
  const bytes = Buffer.from(await file.arrayBuffer());
  const type = imageType(bytes);
  if (!type) return fail("รองรับเฉพาะรูปภาพ JPG, PNG หรือ WEBP");

  // Re-check against the live sheet so the same month cannot be submitted twice.
  const statement = await getStatement(order.householdId, { fresh: true });
  if (!statement) return fail("ไม่พบข้อมูลบ้านนี้", 404);
  if (!isValidSelection(statement.months, order.months) || selectionTotal(statement.months, order.months) !== order.amount) {
    return fail("มีการส่งหลักฐานของเดือนนี้แล้ว หรือยอดเปลี่ยนไป กรุณาโหลดหน้าใหม่", 409);
  }

  try {
    return NextResponse.json(await saveSlip(order, statement, phone, bytes, type));
  } catch (error) {
    console.error("slip save failed", error);
    return fail("ระบบรับสลิปขัดข้องชั่วคราว กรุณาลองใหม่ หรือติดต่อเจ้าหน้าที่", 503);
  }
}

async function saveSlip(
  order: Order, statement: Statement, phone: string, bytes: Buffer, type: { mime: string; ext: string },
) {
  const uploaded = await uploadToDrive({ name: order.ref + "_" + statement.houseNo.replace(/\W/g, "-") + "." + type.ext, type: type.mime, bytes });
  await appendSlip({
    householdId: order.householdId, ref: order.ref, payerName: statement.name, fiscalYear: statement.fiscalYear,
    months: order.months, amount: order.amount, phone,
    evidence: uploaded.webViewLink, picture: "https://drive.google.com/uc?export=view&id=" + uploaded.id, status: "",
  });
  return { ref: order.ref, months: order.months, amount: order.amount };
}
