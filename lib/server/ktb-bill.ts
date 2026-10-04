import "server-only";
import { randomInt } from "node:crypto";
import bwipjs from "bwip-js/node";
import QRCode from "qrcode";
import { MONTHS } from "@/lib/billing";

// Krungthai bill payment, Thai Bankers' Association barcode:
//   "|" + Biller ID (tax ID 13 + suffix 2) CR Ref1 CR Ref2 CR amount in satang
// Printed forms show the CRs as spaces. The same text goes into the QR code.
//
// Both refs are 18 digits, the length Krungthai set up for this Comp Code (see the bank's own forms),
// and can be decoded back without a database:
//   Ref1 = "00" + fiscal year (4) + key type (1) + household key (10) + check digit  → who
//   Ref2 = "00" + order date YYMMDD in BE (6) + months bitmask Oct..Sep (4) + random (5) + check digit → which months
// The check digit (Luhn) catches typos when someone keys the refs into "จ่ายบิล" by hand.

export function billConfig() {
  const taxId = (process.env.BILLER_TAX_ID ?? "").replace(/\D/g, "");
  const suffix = (process.env.BILLER_SUFFIX ?? "").replace(/\D/g, "");
  if (taxId.length !== 13 || suffix.length !== 2) return null;
  return { billerId: taxId + suffix, compCode: process.env.KTB_COMP_CODE || null };
}

function luhn(digits: string) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return String((10 - (sum % 10)) % 10);
}

const withCheck = (body: string) => "00" + body + luhn(body);
// Returns the 15-digit body of a valid ref, or null.
const body = (ref: string) => /^00\d{16}$/.test(ref) && luhn(ref.slice(2, 17)) === ref[17] ? ref.slice(2, 17) : null;

// Sheet keys are plain numbers (up to 8 digits) or AppSheet 8-character hex IDs.
export function encodeRef1(householdId: string) {
  const match = /^(.+)-(\d{4})$/.exec(householdId);
  if (!match) throw new Error("Bad household id " + householdId);
  const [, key, year] = match;
  // Leading zeros would be lost as a number, so such keys go through the hex form instead.
  const encoded = /^(0|[1-9]\d{0,9})$/.test(key) ? "1" + key.padStart(10, "0")
    : /^[0-9a-f]{8}$/i.test(key) ? "2" + String(parseInt(key, 16)).padStart(10, "0")
    : null;
  if (!encoded) throw new Error("Household key cannot be put in Ref1: " + key);
  return withCheck(year + encoded);
}

export function decodeRef1(ref1: string) {
  const digits = body(ref1);
  if (!digits) return null;
  const year = digits.slice(0, 4);
  const type = digits[4];
  const number = digits.slice(5, 15);
  const key = type === "1" ? String(Number(number)) : type === "2" ? Number(number).toString(16).padStart(8, "0") : null;
  return key ? key + "-" + year : null;
}

export function encodeRef2(months: readonly string[], now = new Date()) {
  const mask = months.reduce((bits, month) => bits | (1 << MONTHS.indexOf(month as (typeof MONTHS)[number])), 0);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(now).map((part) => [part.type, part.value]));
  const yymmdd = String(Number(parts.year) + 543).slice(2) + parts.month + parts.day;
  return withCheck(yymmdd + String(mask).padStart(4, "0") + String(randomInt(0, 100000)).padStart(5, "0"));
}

export function decodeRef2(ref2: string) {
  const digits = body(ref2);
  if (!digits) return null;
  const mask = Number(digits.slice(6, 10));
  return MONTHS.filter((_, index) => mask & (1 << index));
}

export async function billPayment(input: { householdId: string; months: readonly string[]; amount: number; ref2: string }) {
  const config = billConfig();
  if (!config) return null;
  const ref1 = encodeRef1(input.householdId);
  const satang = String(Math.round(input.amount * 100));
  const data = "|" + config.billerId + "\r" + ref1 + "\r" + input.ref2 + "\r" + satang;
  const barcode = bwipjs.toSVG({ bcid: "code128", text: data.replace(/\r/g, "^013"), parse: true, height: 14, includetext: false });
  return {
    compCode: config.compCode,
    ref1,
    ref2: input.ref2,
    printed: data.replace(/\r/g, " "),
    barcode: "data:image/svg+xml;base64," + Buffer.from(barcode).toString("base64"),
    qr: await QRCode.toDataURL(data, { margin: 1, width: 560, errorCorrectionLevel: "M" }),
  };
}
