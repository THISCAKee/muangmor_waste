import type { Metadata } from "next";
import { Anuphan, IBM_Plex_Sans_Thai } from "next/font/google";
import "./globals.css";

// Loopless Thai faces for a minimal look. Bold tops out at 600, and only weights that
// show on first paint are loaded, so every preloaded file is used.
const display = Anuphan({ subsets: ["thai", "latin"], weight: ["600"], variable: "--font-display" });
const body = IBM_Plex_Sans_Thai({ subsets: ["thai", "latin"], weight: ["400", "500", "600"], variable: "--font-body" });

export const metadata: Metadata = {
  title: "ค่าจัดเก็บขยะ | เทศบาลตำบลเหมืองหม้อ",
  description: "ตรวจสอบยอดค่าจัดเก็บขยะรายเดือน และชำระเงินออนไลน์ เทศบาลตำบลเหมืองหม้อ อ.เมืองแพร่ จ.แพร่",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="th" className={display.variable + " " + body.variable}><body>{children}</body></html>;
}
