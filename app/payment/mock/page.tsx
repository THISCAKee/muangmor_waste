import { notFound } from "next/navigation";
import { BANKS } from "@/lib/banks";
import { getCharge, paymentProvider } from "@/lib/server/payments";

export const metadata = { title: "จำลองแอปธนาคาร" };

// Stands in for the bank app while PAYMENT_PROVIDER=mock (never available in production builds).
export default async function MockBankPage({ searchParams }: { searchParams: Promise<{ charge?: string; return?: string }> }) {
  const { charge: chargeId = "", return: back = "/" } = await searchParams;
  if (paymentProvider() !== "mock") notFound();
  const charge = await getCharge(chargeId);
  if (!charge || !back.startsWith("/?")) notFound();
  const bank = BANKS.find((item) => item.id === charge.bank);
  const done = back + "&mockCharge=" + encodeURIComponent(chargeId);

  return <main className="mock-bank" style={{ ["--bank" as string]: bank?.color }}>
    <div className="mock-bank-card">
      <p className="mock-bank-app">{bank?.app} · โหมดจำลอง</p>
      <h1>ยืนยันการโอนเงิน</h1>
      <dl>
        <div><dt>ไปยัง</dt><dd>{process.env.PAYEE_NAME || "เทศบาล (ตัวอย่าง)"}</dd></div>
        <div><dt>รายการ</dt><dd>ค่าขยะ {charge.meta.months.join(", ")}</dd></div>
        <div><dt>เลขอ้างอิง</dt><dd>{charge.meta.ref}</dd></div>
      </dl>
      <p className="mock-bank-amount">฿{new Intl.NumberFormat("th-TH").format(charge.meta.amount)}</p>
      <p className="mock-bank-note">ยอดถูกล็อกจากระบบ แก้ไขไม่ได้</p>
      <a className="button mock-bank-confirm" href={done}>ยืนยันโอน</a>
      <a className="mock-bank-cancel" href={back}>ยกเลิก</a>
    </div>
  </main>;
}
