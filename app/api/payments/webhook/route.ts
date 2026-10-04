import { NextResponse } from "next/server";
import { getCharge, recordCharge } from "@/lib/server/payments";

// Opn sends charge.complete here even when the payer never comes back to the site.
// The body is not trusted: the charge is fetched again with the secret key before recording.
export async function POST(request: Request) {
  const event = await request.json().catch(() => null) as { key?: string; data?: { id?: string } } | null;
  if (event?.key !== "charge.complete" || typeof event.data?.id !== "string") return NextResponse.json({ ignored: true });
  const charge = await getCharge(event.data.id);
  if (!charge) return NextResponse.json({ ignored: true });
  await recordCharge(charge); // throws → 500, so Opn retries later
  return NextResponse.json({ ok: true });
}
