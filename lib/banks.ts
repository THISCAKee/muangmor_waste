// Banks whose apps the gateway can open with the amount and payee already filled in.
// Colours are only used for the round badge on each choice.
export const BANKS = [
  { id: "kbank", name: "กสิกรไทย", app: "K PLUS", short: "K", color: "#138f2d" },
  { id: "scb", name: "ไทยพาณิชย์", app: "SCB EASY", short: "SCB", color: "#4e2e7f" },
  { id: "ktb", name: "กรุงไทย", app: "Krungthai NEXT", short: "KTB", color: "#1ba5e1" },
  { id: "bbl", name: "กรุงเทพ", app: "Bualuang mBanking", short: "BBL", color: "#1e4598" },
  { id: "bay", name: "กรุงศรีอยุธยา", app: "KMA", short: "BAY", color: "#c8a100" },
] as const;

export type BankId = (typeof BANKS)[number]["id"];

export const isBankId = (value: unknown): value is BankId => BANKS.some((bank) => bank.id === value);
