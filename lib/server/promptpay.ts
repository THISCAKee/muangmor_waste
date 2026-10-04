import "server-only";

// EMVCo merchant-presented QR for Thai PromptPay. With an amount in tag 54 the bank app
// shows the amount locked, so the payer cannot change it.
function tag(id: string, value: string) {
  return id + String(value.length).padStart(2, "0") + value;
}

function crc16(payload: string) {
  let crc = 0xffff;
  for (const byte of Buffer.from(payload, "utf8")) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

// target: mobile number (10 digits), tax ID / citizen ID (13 digits) or e-wallet ID (15 digits).
export function promptPayPayload(target: string, amount: number) {
  const id = target.replace(/\D/g, "");
  const account = id.length === 10 ? tag("01", ("0066" + id.slice(1)).padStart(13, "0"))
    : id.length === 13 ? tag("02", id)
    : id.length === 15 ? tag("03", id)
    : null;
  if (!account) throw new Error("PROMPTPAY_ID must be a 10-digit phone, 13-digit tax ID or 15-digit e-wallet ID");
  const body = tag("00", "01") + tag("01", "12") + tag("29", tag("00", "A000000677010111") + account)
    + tag("53", "764") + tag("54", amount.toFixed(2)) + tag("58", "TH") + "6304";
  return body + crc16(body);
}
