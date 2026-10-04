import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// A payment order is not stored anywhere: the server signs the amount and months it calculated,
// and only accepts a slip that carries an untampered, unexpired token.
export type Order = { householdId: string; months: string[]; amount: number; ref: string; expiresAt: number };

const LIFETIME_MS = 24 * 60 * 60 * 1000;

function secret() {
  const value = process.env.ORDER_SECRET;
  if (!value || value.length < 32) throw new Error("ORDER_SECRET must be set (at least 32 characters)");
  return value;
}

const sign = (body: string) => createHmac("sha256", secret()).update(body).digest("base64url");

export function newReference(now = new Date()) {
  const ymd = now.toISOString().slice(2, 10).replace(/-/g, "");
  return "WM" + ymd + randomBytes(3).toString("hex").toUpperCase();
}

export function createOrderToken(order: Omit<Order, "expiresAt">) {
  const body = Buffer.from(JSON.stringify({ ...order, expiresAt: Date.now() + LIFETIME_MS })).toString("base64url");
  return body + "." + sign(body);
}

export function readOrderToken(token: string): Order | null {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const order = JSON.parse(Buffer.from(body, "base64url").toString()) as Order;
  return order.expiresAt > Date.now() ? order : null;
}
