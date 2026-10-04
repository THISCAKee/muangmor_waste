import "server-only";
import { createHmac } from "node:crypto";
import type { BankId } from "@/lib/banks";
import { hasGoogleCredentials } from "@/lib/server/google";
import { appendSlip, slipExists } from "@/lib/server/slip-sheet";

// Gateway that opens the payer's bank app with the amount locked and confirms the payment by itself.
// PAYMENT_PROVIDER=opn uses Opn Payments (Omise) mobile banking; =mock simulates the bank for demos.
export type PaymentMeta = { householdId: string; months: string[]; amount: number; ref: string; payerName: string; fiscalYear: string };
export type Charge = { id: string; status: "pending" | "successful" | "failed" | "expired"; amountSatang: number; bank: string; meta: PaymentMeta };

export function paymentProvider() {
  const provider = process.env.PAYMENT_PROVIDER;
  if (provider === "opn" && process.env.OPN_SECRET_KEY) return "opn" as const;
  if (provider === "mock" && process.env.NODE_ENV !== "production") return "mock" as const;
  return null;
}

// Opn rejects mobile-banking charges below its minimum (20 THB at the time of writing).
export const MIN_BANK_AMOUNT = Number(process.env.PAYMENT_MIN_AMOUNT || 20);

async function opn(path: string, init: RequestInit = {}) {
  const response = await fetch("https://api.omise.co" + path, {
    ...init,
    headers: { ...init.headers, Authorization: "Basic " + Buffer.from(process.env.OPN_SECRET_KEY + ":").toString("base64") },
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok || data.object === "error") throw new Error("Opn " + response.status + ": " + (data.message || data.code));
  return data;
}

function fromOpn(data: { id: string; status: Charge["status"]; amount: number; source?: { type?: string }; metadata?: Record<string, string> }): Charge {
  const m = data.metadata ?? {};
  return {
    id: data.id, status: data.status, amountSatang: data.amount, bank: (data.source?.type ?? "").replace("mobile_banking_", ""),
    meta: { householdId: m.householdId, months: (m.months ?? "").split(",").filter(Boolean), amount: Number(m.amount), ref: m.ref, payerName: m.payerName, fiscalYear: m.fiscalYear },
  };
}

// Mock charges carry their own data, signed so the simulated "bank" page cannot change the amount.
const mockSign = (body: string) => createHmac("sha256", process.env.ORDER_SECRET || "").update(body).digest("base64url").slice(0, 16);

export async function createBankCharge(input: { bank: BankId; platform: "IOS" | "ANDROID"; meta: PaymentMeta; returnUri: string }) {
  const provider = paymentProvider();
  if (provider === "opn") {
    const body = new URLSearchParams({
      amount: String(Math.round(input.meta.amount * 100)), currency: "THB", return_uri: input.returnUri,
      description: "ค่าขยะ " + input.meta.ref,
      "source[type]": "mobile_banking_" + input.bank, "source[platform_type]": input.platform,
    });
    for (const [key, value] of Object.entries(input.meta)) body.set("metadata[" + key + "]", Array.isArray(value) ? value.join(",") : String(value));
    const data = await opn("/charges", { method: "POST", body });
    if (!data.authorize_uri) throw new Error("Opn did not return an authorize_uri");
    return { chargeId: data.id as string, authorizeUri: data.authorize_uri as string };
  }
  if (provider === "mock") {
    const body = Buffer.from(JSON.stringify({ bank: input.bank, meta: input.meta })).toString("base64url");
    const chargeId = "mock." + body + "." + mockSign(body);
    const back = new URL(input.returnUri);
    const authorizeUri = "/payment/mock?" + new URLSearchParams({ charge: chargeId, return: back.pathname + back.search });
    return { chargeId, authorizeUri };
  }
  throw new Error("No payment gateway configured");
}

export async function getCharge(chargeId: string): Promise<Charge | null> {
  const provider = paymentProvider();
  if (provider === "opn" && /^chrg_[a-z0-9_]+$/i.test(chargeId)) return fromOpn(await opn("/charges/" + chargeId));
  if (provider === "mock" && chargeId.startsWith("mock.")) {
    const [, body, signature] = chargeId.split(".");
    if (!body || mockSign(body) !== signature) return null;
    const { bank, meta } = JSON.parse(Buffer.from(body, "base64url").toString()) as { bank: string; meta: PaymentMeta };
    return { id: "mock-" + meta.ref, status: "successful", amountSatang: Math.round(meta.amount * 100), bank, meta };
  }
  return null;
}

// Writes a confirmed payment to the slip sheet once; safe to call from both the webhook and the return page.
export async function recordCharge(charge: Charge) {
  if (charge.status !== "successful") return { recorded: false, status: charge.status };
  if (charge.amountSatang !== Math.round(charge.meta.amount * 100)) throw new Error("Charge amount does not match its order");
  // Demo without Google access: show the flow end to end but nothing can be written.
  if (charge.id.startsWith("mock-") && !hasGoogleCredentials()) return { recorded: false, status: charge.status };
  if (await slipExists(charge.id)) return { recorded: true, status: charge.status };
  await appendSlip({
    householdId: charge.meta.householdId, ref: charge.meta.ref, payerName: charge.meta.payerName, fiscalYear: charge.meta.fiscalYear,
    months: charge.meta.months, amount: charge.meta.amount, phone: "",
    evidence: "ชำระออนไลน์ " + charge.bank.toUpperCase() + " " + charge.id, status: "✅ชำระออนไลน์",
  });
  return { recorded: true, status: charge.status };
}
