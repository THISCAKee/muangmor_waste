"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import SiteHeader from "@/components/site-header";
import YearRing from "@/components/year-ring";
import { BANKS, type BankId } from "@/lib/banks";
import { isDue, type HouseholdSummary, type MonthName, type MonthState, type Statement } from "@/lib/billing";

const STATUS_COPY: Record<MonthState, string> = {
  exempt: "ยกเว้น", paid: "ชำระแล้ว", pending: "รอตรวจสอบ", rejected: "ส่งสลิปใหม่", unpaid: "ค้างชำระ",
};

const SHORT_MONTHS = ["ต.ค.", "พ.ย.", "ธ.ค.", "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย."];

type KtbBill = { compCode: string | null; ref1: string; ref2: string; printed: string; barcode: string; qr: string };
type Order = { token: string; ref: string; amount: number; months: MonthName[]; qr: string | null; ktb: KtbBill | null; payee: string | null; bankApp: boolean };
type Platform = "IOS" | "ANDROID" | null;
type PaymentCheck = { ref: string; state: "checking" | "paid" | "pending" | "failed" | "unknown"; recorded?: boolean; message?: string };

const CHARGE_KEY = "wm-charge-";

function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "IOS";
  if (/Android/.test(ua)) return "ANDROID";
  return null;
}

function remember(key: string, value?: string) {
  try {
    if (value === undefined) return window.localStorage.getItem(key);
    window.localStorage.setItem(key, value);
  } catch {}
  return null;
}

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

function money(amount: number) {
  return new Intl.NumberFormat("th-TH").format(amount);
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((data as { error?: string }).error || "ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง");
  return data as T;
}

// Phone photos are often 3–8 MB; shrink to a readable JPEG so uploads work on slow connections.
async function shrinkImage(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    return blob ?? file;
  } catch {
    return file;
  }
}

const SUGGEST_LIMIT = 8;

function Highlight({ text, term }: { text: string; term: string }) {
  const at = term ? text.indexOf(term) : -1;
  if (at < 0) return <>{text}</>;
  return <>{text.slice(0, at)}<mark>{text.slice(at, at + term.length)}</mark>{text.slice(at + term.length)}</>;
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {}
  }
  return <div className="copy-row"><span><small>{label}</small><b>{value}</b></span><button type="button" className="copy-button" onClick={copy}>{copied ? "คัดลอกแล้ว" : "คัดลอก"}</button></div>;
}

function SearchGlyph() {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.4" stroke="currentColor" strokeWidth="2" /><path d="m16 16 4.2 4.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>;
}

function StatusIcon({ state }: { state: MonthState }) {
  const inner = state === "paid" ? <path d="m8.5 12.2 2.4 2.4 4.6-4.8" />
    : state === "pending" ? <path d="M12 7.8V12l2.6 1.6" />
    : state === "exempt" ? <path d="M8.5 12h7" />
    : <><path d="M12 7.8v4.6" /><path d="M12 16.1v.1" /></>;
  return <svg className="status-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" />{inner}</svg>;
}

function Stepper({ step, done }: { step: 1 | 2 | 3; done: boolean }) {
  const labels = ["ค้นหาบ้าน", "เลือกเดือน", "ชำระเงิน"];
  return <ol className="stepper" aria-label="ขั้นตอนการใช้งาน">
    {labels.map((label, i) => {
      const n = i + 1;
      const state = n < step || (done && n === 3) ? "done" : n === step ? "current" : "todo";
      return <li key={label} className={"step step-" + state} aria-current={state === "current" ? "step" : undefined}>
        <span className="step-num">{state === "done" ? "✓" : n}</span><span className="step-label">{label}</span>
      </li>;
    })}
  </ol>;
}

export default function CitizenPortal() {
  const [years, setYears] = useState<string[]>([]);
  const [fiscalYear, setFiscalYear] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<HouseholdSummary[]>([]);
  const [searchedFor, setSearchedFor] = useState("");
  const [searching, setSearching] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [statement, setStatement] = useState<Statement | null>(null);
  const [selectedMonths, setSelectedMonths] = useState<MonthName[]>([]);
  const [order, setOrder] = useState<Order | null>(null);
  const [ordering, setOrdering] = useState(false);
  const [phone, setPhone] = useState("");
  const [proof, setProof] = useState<File | null>(null);
  const [formError, setFormError] = useState("");
  const [sending, setSending] = useState(false);
  const [receiptRef, setReceiptRef] = useState("");
  const [suggestions, setSuggestions] = useState<HouseholdSummary[]>([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const skipSuggest = useRef(false);
  const [platform, setPlatform] = useState<Platform>(null);
  const [payingBank, setPayingBank] = useState<BankId | null>(null);
  const [payError, setPayError] = useState("");
  const [paymentCheck, setPaymentCheck] = useState<PaymentCheck | null>(null);

  useEffect(() => setPlatform(detectPlatform()), []);

  // Coming back from the bank app: /?payment=<ref>&h=<household>. Ask the server to confirm the charge with the gateway.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("payment");
    const householdId = params.get("h");
    if (!ref || !householdId) return;
    const chargeId = params.get("mockCharge") || remember(CHARGE_KEY + ref);
    window.history.replaceState(null, "", "/");
    setPaymentCheck({ ref, state: "checking" });
    (async () => {
      if (!chargeId) {
        setPaymentCheck({ ref, state: "unknown" });
      } else {
        for (let attempt = 0; attempt < 6; attempt++) {
          try {
            const result = await api<{ status: string; recorded: boolean }>("/api/payments/confirm", {
              method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chargeId }),
            });
            if (result.status === "successful") { setPaymentCheck({ ref, state: "paid", recorded: result.recorded }); break; }
            if (result.status === "failed" || result.status === "expired") { setPaymentCheck({ ref, state: "failed" }); break; }
            setPaymentCheck({ ref, state: "pending" });
          } catch (error) {
            setPaymentCheck({ ref, state: "failed", message: (error as Error).message });
            break;
          }
          await wait(2500);
        }
      }
      try {
        setStatement(await api<Statement>("/api/households/" + encodeURIComponent(householdId)));
      } catch {}
    })();
  }, []);

  useEffect(() => {
    api<{ years: string[]; current: string }>("/api/years")
      .then((data) => { setYears(data.years); setFiscalYear(data.current); })
      .catch((error: Error) => setLoadError(error.message));
  }, []);

  useEffect(() => {
    if (statement) document.getElementById("statement")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [statement?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (searchedFor) document.getElementById("results")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [searchedFor, results]);

  // Suggest names while typing; wait for a pause and drop replies to older keystrokes.
  useEffect(() => {
    const term = query.trim();
    if (skipSuggest.current) { skipSuggest.current = false; return; }
    if (!fiscalYear || term.length < 2 && !/^\d/.test(term)) {
      setSuggestions([]);
      setSuggestOpen(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      api<{ results: HouseholdSummary[] }>("/api/households?year=" + fiscalYear + "&q=" + encodeURIComponent(term), { signal: controller.signal })
        .then((data) => { setSuggestions(data.results.slice(0, SUGGEST_LIMIT)); setActiveIndex(-1); setSuggestOpen(true); })
        .catch(() => {});
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, fiscalYear]);

  useEffect(() => {
    if (!order) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape" && !sending) setOrder(null); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [order, sending]);

  const lines = statement?.months ?? [];
  const dueLines = lines.filter((line) => isDue(line.state));
  const dueTotal = dueLines.reduce((sum, line) => sum + line.amount, 0);
  const paidCount = lines.filter((line) => line.state === "paid").length;
  const pendingCount = lines.filter((line) => line.state === "pending").length;
  const exemptCount = lines.filter((line) => line.state === "exempt").length;
  const selectedTotal = lines.filter((line) => selectedMonths.includes(line.month)).reduce((sum, line) => sum + line.amount, 0);
  const step = order || receiptRef ? 3 : statement ? 2 : 1;

  async function runSearch(text: string) {
    if (!fiscalYear || !text.trim()) return;
    setSearching(true);
    setLoadError("");
    try {
      const data = await api<{ results: HouseholdSummary[] }>("/api/households?year=" + fiscalYear + "&q=" + encodeURIComponent(text.trim()));
      setResults(data.results);
      setSearchedFor(text.trim());
      setStatement(null);
      setSelectedMonths([]);
      setReceiptRef("");
    } catch (error) {
      setLoadError((error as Error).message);
    } finally {
      setSearching(false);
    }
  }

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSuggestOpen(false);
    runSearch(query);
  }

  function pickSuggestion(candidate: HouseholdSummary) {
    // Filling the box with the chosen name should not reopen the list.
    if (candidate.name !== query) {
      skipSuggest.current = true;
      setQuery(candidate.name);
    }
    setSuggestOpen(false);
    choose(candidate);
  }

  function suggestKeys(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (!suggestOpen || !suggestions.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((index) => (index + step + suggestions.length) % suggestions.length);
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      pickSuggestion(suggestions[activeIndex]);
    } else if (event.key === "Escape") {
      setSuggestOpen(false);
    }
  }

  async function loadStatement(id: string) {
    setLoadError("");
    try {
      setStatement(await api<Statement>("/api/households/" + encodeURIComponent(id)));
    } catch (error) {
      setLoadError((error as Error).message);
    }
  }

  async function choose(candidate: HouseholdSummary) {
    setResults([]);
    setSearchedFor("");
    setSelectedMonths([]);
    setReceiptRef("");
    await loadStatement(candidate.id);
  }

  function canSelect(index: number) {
    if (!isDue(lines[index]?.state)) return false;
    return lines.slice(0, index).every((previous) => !isDue(previous.state) || selectedMonths.includes(previous.month));
  }

  function toggleMonth(month: MonthName, index: number) {
    if (selectedMonths.includes(month)) {
      setSelectedMonths(selectedMonths.filter((selected) => lines.findIndex((line) => line.month === selected) < index));
    } else if (canSelect(index)) {
      setSelectedMonths([...selectedMonths, month]);
    }
  }

  function toggleAllDue() {
    setSelectedMonths(selectedMonths.length === dueLines.length ? [] : dueLines.map((line) => line.month));
  }

  function changeHouse() {
    setStatement(null);
    setSelectedMonths([]);
    setReceiptRef("");
    setPaymentCheck(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
    document.getElementById("household-query")?.focus({ preventScroll: true });
  }

  async function startPayment() {
    if (!statement || !selectedMonths.length) return;
    setOrdering(true);
    setLoadError("");
    try {
      const created = await api<Order>("/api/orders", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ householdId: statement.id, months: selectedMonths }),
      });
      setOrder(created);
      setProof(null);
      setFormError("");
    } catch (error) {
      setLoadError((error as Error).message);
      await loadStatement(statement.id);
      setSelectedMonths([]);
    } finally {
      setOrdering(false);
    }
  }

  async function payWithBank(bank: BankId) {
    if (!order || !platform) return;
    setPayingBank(bank);
    setPayError("");
    try {
      const charge = await api<{ chargeId: string; authorizeUri: string }>("/api/payments", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: order.token, bank, platform }),
      });
      remember(CHARGE_KEY + order.ref, charge.chargeId);
      window.location.href = charge.authorizeUri;
    } catch (error) {
      setPayError((error as Error).message);
      setPayingBank(null);
    }
  }

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null;
    setFormError("");
    if (file && !file.type.startsWith("image/")) {
      setProof(null);
      setFormError("เลือกไฟล์รูปภาพสลิปเท่านั้น");
      event.target.value = "";
      return;
    }
    setProof(file);
  }

  async function submitSlip(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!order || !statement) return;
    if (!/^0\d{9}$/.test(phone.replace(/[-\s]/g, ""))) {
      setFormError("กรอกเบอร์โทรศัพท์มือถือ 10 หลักให้ถูกต้อง");
      return;
    }
    if (!proof) {
      setFormError("แนบรูปสลิปก่อนส่ง");
      return;
    }
    setSending(true);
    setFormError("");
    try {
      const body = new FormData();
      body.set("token", order.token);
      body.set("phone", phone);
      body.set("file", await shrinkImage(proof), "slip.jpg");
      const saved = await api<{ ref: string }>("/api/slips", { method: "POST", body });
      setReceiptRef(saved.ref);
      setOrder(null);
      setSelectedMonths([]);
      setProof(null);
      await loadStatement(statement.id);
    } catch (error) {
      setFormError((error as Error).message);
    } finally {
      setSending(false);
    }
  }

  const qrFlow = order && <>
    <ol className="modal-steps">
      <li><b>สแกนจ่ายด้วยแอปธนาคาร</b>
        {order.ktb ? <>
          <div className="qr-box">
            <img src={order.ktb.qr} alt={"QR ชำระบิล ยอด " + money(order.amount) + " บาท"} width={220} height={220} />
            <div className="qr-help">
              <p>ใช้ได้กับแอปทุกธนาคาร ยอดและเลขอ้างอิงถูกล็อกไว้ใน QR แล้ว</p>
              <a className="button button-ghost" href={order.ktb.qr} download={"QR-" + order.ref + ".png"}>บันทึกรูป QR</a>
              <small>ใช้มือถือเครื่องเดียว: บันทึกรูป แล้วเปิดแอปธนาคาร → สแกน → เลือกรูปจากอัลบั้ม</small>
            </div>
          </div>
          <details className="alt-pay">
            <summary>จ่ายบิลในแอป Krungthai NEXT (กรอกเอง)</summary>
            <div className="copy-list">
              {order.ktb.compCode && <CopyRow label="Comp Code" value={order.ktb.compCode} />}
              <CopyRow label="Ref.1" value={order.ktb.ref1} />
              <CopyRow label="Ref.2" value={order.ktb.ref2} />
              <CopyRow label="จำนวนเงิน (บาท)" value={order.amount.toFixed(2)} />
            </div>
            <small className="copy-hint">เมนู จ่ายบิล → ค้นหาด้วย Comp Code → กรอก Ref.1, Ref.2 และยอดให้ตรงตามนี้</small>
          </details>
          <details className="alt-pay">
            <summary>ชำระที่เคาน์เตอร์ธนาคารกรุงไทย</summary>
            <div className="barcode-box">
              <img src={order.ktb.barcode} alt="บาร์โค้ดชำระเงิน" />
              <code>{order.ktb.printed}</code>
            </div>
            <small className="copy-hint">แสดงบาร์โค้ดนี้ที่เคาน์เตอร์ ธนาคารอาจเก็บค่าธรรมเนียม</small>
          </details>
        </> : order.qr ? <div className="qr-box">
          <img src={order.qr} alt={"QR พร้อมเพย์ ยอด " + money(order.amount) + " บาท"} width={220} height={220} />
          <div className="qr-help">
            {order.payee && <p>ชื่อบัญชี <b>{order.payee}</b></p>}
            <p>ยอดถูกล็อกไว้ใน QR แล้ว ไม่ต้องพิมพ์ยอดเอง</p>
            <a className="button button-ghost" href={order.qr} download={"QR-" + order.ref + ".png"}>บันทึกรูป QR</a>
            <small>ใช้มือถือเครื่องเดียว: บันทึกรูป แล้วเปิดแอปธนาคาร → สแกน → เลือกรูปจากอัลบั้ม</small>
          </div>
        </div> : <div className="notice notice-warn"><span>ยังไม่ได้ตั้งค่าเลขพร้อมเพย์ของเทศบาล กรุณาติดต่อเจ้าหน้าที่</span></div>}
      </li>
      <li><b>แนบสลิปหลังโอนเสร็จ</b>
        <form className="proof-form" id="proof-form" onSubmit={submitSlip}>
          <label className="field"><span className="field-label">เบอร์โทรศัพท์ติดต่อกลับ</span><input type="tel" inputMode="numeric" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="08x xxx xxxx" maxLength={12} /></label>
          <label className={"drop" + (proof ? " has-file" : "")}><input type="file" accept="image/*" onChange={chooseFile} />
            <span className="drop-icon"><svg viewBox="0 0 24 24" fill="none"><path d="M12 16V4m0 0L8 8m4-4 4 4M5 16v3h14v-3" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
            <span className="drop-text"><b>{proof ? proof.name : "แตะเพื่อเลือกรูปสลิป"}</b><small>{proof ? "แตะเพื่อเปลี่ยนรูป" : "รูปภาพจากแอปธนาคาร"}</small></span>
          </label>
          {formError && <p className="form-error" role="alert">{formError}</p>}
        </form>
      </li>
    </ol>
    <button className="button button-go modal-submit" type="submit" form="proof-form" disabled={sending}>{sending ? "กำลังส่ง…" : "ส่งสลิป ฿" + money(order.amount)}</button>
  </>;

  return <main>
    <SiteHeader />

    <section className="hero">
      <div className="shell hero-inner">
        {fiscalYear && <p className="chip">ปีงบประมาณ {fiscalYear} · ต.ค. {Number(fiscalYear) - 1} – ก.ย. {fiscalYear}</p>}
        <h1>ตรวจสอบและชำระค่าขยะ</h1>
        <p className="hero-intro">ค้นหาด้วยชื่อหรือบ้านเลขที่ ดูยอดค้างรายเดือน แล้วชำระผ่านแอปธนาคาร</p>

        <form className="lookup-form" onSubmit={search} role="search">
          <div className="field search-field">
            <label className="field-label" htmlFor="household-query">ชื่อผู้ชำระ หรือบ้านเลขที่</label>
            <div className="input-wrap"><SearchGlyph />
              <input id="household-query" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={suggestKeys}
                onFocus={() => suggestions.length && setSuggestOpen(true)} onBlur={() => setSuggestOpen(false)}
                placeholder="เช่น สมใจ หรือ 75/5" autoComplete="off" enterKeyHint="search"
                role="combobox" aria-autocomplete="list" aria-expanded={suggestOpen} aria-controls="household-suggestions"
                aria-activedescendant={suggestOpen && activeIndex >= 0 ? "suggestion-" + activeIndex : undefined} />
              {suggestOpen && <ul className="suggestions" id="household-suggestions" role="listbox" aria-label="รายชื่อที่ตรงกับคำค้น">
                {suggestions.length ? suggestions.map((candidate, index) => <li key={candidate.id} id={"suggestion-" + index} role="option" aria-selected={index === activeIndex}
                  className={index === activeIndex ? "is-active" : undefined}
                  onMouseDown={(event) => event.preventDefault()} onClick={() => pickSuggestion(candidate)} onMouseEnter={() => setActiveIndex(index)}>
                  <span className="suggestion-name"><Highlight text={candidate.name} term={query.trim().replace(/\s+/g, " ")} /></span>
                  <span className="suggestion-meta">บ้านเลขที่ <b>{candidate.houseNo || "–"}</b> · หมู่ {candidate.moo}</span>
                </li>) : <li className="suggestion-empty">ไม่พบชื่อหรือบ้านเลขที่นี้ในปี {fiscalYear}</li>}
              </ul>}
            </div>
          </div>
          <label className="field year-field">
            <span className="field-label">ปีงบประมาณ</span>
            <span className="select-wrap"><select value={fiscalYear} onChange={(event) => setFiscalYear(event.target.value)} disabled={!years.length}>{years.map((year) => <option key={year} value={year}>{year}</option>)}</select></span>
          </label>
          <button className="button button-go" type="submit" disabled={searching || !fiscalYear}>{searching ? "กำลังค้นหา…" : "ค้นหา"}</button>
        </form>
        {loadError && <p className="hero-error" role="alert">{loadError}</p>}

        {searchedFor && <div className="search-results" id="results" aria-live="polite">
          {results.length ? <>
            <p className="results-heading"><b>พบ {results.length}{results.length === 30 ? "+" : ""} บ้าน</b> แตะเลือกบ้านของคุณ (ดูบ้านเลขที่และหมู่ให้ตรง)</p>
            <div className="result-list">{results.map((candidate) => <button className="result-card" type="button" key={candidate.id} onClick={() => choose(candidate)}>
              <span className="result-house"><small>บ้านเลขที่</small><b>{candidate.houseNo || "–"}</b></span>
              <span className="result-details"><b>{candidate.name}</b><small>หมู่ {candidate.moo}</small></span>
              <span className="result-arrow" aria-hidden="true">→</span>
            </button>)}</div>
          </> : <div className="empty-search"><b>ไม่พบบ้านที่ตรงกับ “{searchedFor}”</b><p>ลองพิมพ์แค่ชื่อจริง (ไม่ต้องมีนาย/นาง) หรือบ้านเลขที่ หรือเปลี่ยนปีงบประมาณ</p></div>}
        </div>}
        <Stepper step={step} done={Boolean(receiptRef)} />
      </div>
    </section>

    {statement ? <section className="statement shell" id="statement">
      {paymentCheck && <div className={"notice " + (paymentCheck.state === "paid" ? "notice-success" : paymentCheck.state === "failed" ? "notice-error" : "notice-info")} role="status">
        <span className="notice-icon">{paymentCheck.state === "paid" ? "✓" : paymentCheck.state === "failed" ? "!" : "…"}</span>
        <div>
          <b>{paymentCheck.state === "paid" ? (paymentCheck.recorded ? "ชำระเงินสำเร็จ ระบบบันทึกให้แล้ว" : "ชำระเงินสำเร็จ (โหมดทดลอง ยังไม่บันทึกลงชีต)")
            : paymentCheck.state === "failed" ? (paymentCheck.message ? "ตรวจสอบการชำระไม่สำเร็จ" : "การชำระไม่สำเร็จหรือถูกยกเลิก")
            : paymentCheck.state === "checking" ? "กำลังตรวจสอบการชำระกับธนาคาร…"
            : "ยังไม่ได้รับการยืนยันจากธนาคาร"}</b>
          <p>{paymentCheck.message || (paymentCheck.state === "paid" ? "ไม่ต้องส่งสลิป" : paymentCheck.state === "failed" ? "ยังไม่มีการตัดเงิน เลือกเดือนแล้วกดชำระใหม่ได้" : "ถ้าโอนเสร็จแล้ว สถานะจะอัปเดตภายในไม่กี่นาที")} · เลขอ้างอิง <code>{paymentCheck.ref}</code></p>
        </div>
      </div>}
      {receiptRef && <div className="notice notice-success" role="status"><span className="notice-icon">✓</span><div><b>ส่งสลิปแล้ว รอเจ้าหน้าที่ตรวจสอบ</b><p>เลขอ้างอิง <code>{receiptRef}</code> กลับมาค้นหาบ้านอีกครั้งเพื่อดูสถานะได้</p></div></div>}

      <div className="card household-head">
        <div>
          <p className="eyebrow">ปีงบประมาณ {statement.fiscalYear} · อัตราเดือนละ ฿{money(statement.monthlyRate)}</p>
          <h2>{statement.name}</h2>
          <p className="household-address">บ้านเลขที่ {statement.houseNo} หมู่ {statement.moo} ต.{statement.subdistrict} อ.{statement.district} จ.{statement.province}</p>
        </div>
        <button type="button" className="button button-ghost button-small" onClick={changeHouse}>เปลี่ยนบ้าน</button>
      </div>

      <div className="statement-layout">
        <div className="statement-main">
          <div className="card months-card">
            <div className="months-head">
              <div><h3>เลือกเดือนที่ต้องการชำระ</h3><p>ต.ค. {Number(statement.fiscalYear) - 1} – ก.ย. {statement.fiscalYear} · {dueLines.length ? "ชำระเรียงจากเดือนเก่าก่อน" : "ชำระครบทุกเดือนแล้ว"}</p></div>
              {dueLines.length > 0 && <button type="button" className="link-button" onClick={toggleAllDue}>{selectedMonths.length === dueLines.length ? "ล้างที่เลือก" : "เลือกทั้งหมด"}</button>}
            </div>
            <div className="month-grid">{lines.map((line, index) => {
              const selectable = canSelect(index);
              const selected = selectedMonths.includes(line.month);
              const due = isDue(line.state);
              const year = index < 3 ? Number(statement.fiscalYear) - 1 : Number(statement.fiscalYear);
              return <button type="button" key={line.month} className={"month-cell month-" + line.state + (selected ? " is-selected" : "") + (selectable ? " is-selectable" : "")}
                onClick={() => toggleMonth(line.month, index)} aria-pressed={due ? selected : undefined} disabled={!selectable && !selected}
                aria-label={line.month + " " + year + " " + STATUS_COPY[line.state] + (due ? " " + money(line.amount) + " บาท" : "")}>
                <span className="month-cell-top">
                  {due ? <span className="checkbox" aria-hidden="true">{selected && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5.5 12.5 4 4 9-9.5" /></svg>}</span>
                    : <StatusIcon state={line.state} />}
                  <span className="month-name"><span className="m-full">{line.month}</span><span className="m-short">{SHORT_MONTHS[index]}</span></span>
                </span>
                <span className="month-state">{due && <StatusIcon state={line.state} />}{STATUS_COPY[line.state]}</span>
                <span className="month-amount">{due ? "฿" + money(line.amount) : "\u00a0"}</span>
              </button>;
            })}</div>
            {dueLines.length > 0 && selectedMonths.length < dueLines.length && <p className="hint">เดือนที่เป็นสีจางจะเลือกได้ เมื่อเลือกเดือนก่อนหน้าแล้ว</p>}
          </div>
        </div>

        <aside className="statement-side">
          <div className="card summary-card">
            <YearRing lines={lines} selected={selectedMonths}>
              {dueLines.length ? <>
                <small>ค้างชำระ</small>
                <strong>฿{money(dueTotal)}</strong>
                <span>{dueLines.length} เดือน</span>
              </> : <>
                <strong className="ring-clear">ครบแล้ว</strong>
                <span>ไม่มียอดค้าง</span>
              </>}
            </YearRing>
            <ul className="ring-legend" aria-label="สรุปสถานะ">
              {paidCount > 0 && <li><i className="swatch swatch-paid" />ชำระแล้ว {paidCount}</li>}
              {pendingCount > 0 && <li><i className="swatch swatch-pending" />รอตรวจสอบ {pendingCount}</li>}
              {dueLines.length > 0 && <li><i className="swatch swatch-due" />ค้างชำระ {dueLines.length}</li>}
              {exemptCount > 0 && <li><i className="swatch swatch-exempt" />ยกเว้น {exemptCount}</li>}
            </ul>
            {dueLines.length > 0 && <>
              <dl className="summary-lines">
                <div><dt>ค้างชำระทั้งหมด</dt><dd>฿{money(dueTotal)}</dd></div>
                <div className="summary-selected"><dt>เลือกชำระ {selectedMonths.length} เดือน</dt><dd>฿{money(selectedTotal)}</dd></div>
              </dl>
              <button className="button button-go button-block" type="button" onClick={startPayment} disabled={!selectedMonths.length || ordering}>
                {ordering ? "กำลังสร้างรายการ…" : selectedMonths.length ? "ชำระเงิน ฿" + money(selectedTotal) : "เลือกเดือนที่จะชำระ"}
              </button>
              <p className="secure-note"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" /></svg>ยอดคำนวณจากระบบเทศบาล แก้ไขไม่ได้</p>
            </>}
          </div>
        </aside>
      </div>

      {dueLines.length > 0 && <div className="pay-bar" aria-live="polite">
        <div className="pay-bar-total"><small>{selectedMonths.length ? "เลือก " + selectedMonths.length + " เดือน" : "ยังไม่ได้เลือกเดือน"}</small><strong>฿{money(selectedTotal)}</strong></div>
        <button className="button button-go" type="button" onClick={startPayment} disabled={!selectedMonths.length || ordering}>{ordering ? "กำลังสร้าง…" : "ชำระเงิน"}</button>
      </div>}
    </section> : null}

    <footer className="site-footer"><div className="shell footer-inner">
      <span><b>เทศบาลตำบลเหมืองหม้อ</b> 160 หมู่ 1 ต.เหมืองหม้อ อ.เมืองแพร่ จ.แพร่ 54000</span>
      <span>ยอดไม่ถูกต้องหรือสอบถาม โทร <a href="tel:054624310">054-624310</a> ต่อ 110</span>
    </div></footer>

    {order && statement && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !sending) setOrder(null); }}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="payment-title">
        <button className="modal-close" type="button" onClick={() => setOrder(null)} disabled={sending} aria-label="ปิดหน้าต่าง">×</button>
        <h2 id="payment-title">ชำระค่าบริการ</h2>
        <p className="modal-sub">{statement.name} · บ้านเลขที่ {statement.houseNo} · เลขอ้างอิง {order.ref}</p>

        <div className="summary">
          <div className="summary-months">{order.months.map((month) => <span key={month}>{month}</span>)}</div>
          <div className="summary-total"><span>ยอดที่ต้องชำระ</span><strong>฿{money(order.amount)}</strong></div>
        </div>

        {order.bankApp ? <>
          <h3 className="pay-heading">เลือกธนาคารที่จะใช้โอน</h3>
          {!platform && <div className="notice notice-warn bank-desktop-note"><span>เปิดหน้านี้บนมือถือที่มีแอปธนาคาร เพื่อกดเลือกธนาคารแล้วโอนได้ทันที</span></div>}
          <div className="bank-grid">{BANKS.map((bank) => <button type="button" key={bank.id} className="bank-choice" onClick={() => payWithBank(bank.id)} disabled={!platform || Boolean(payingBank)}>
            <span className="bank-badge" style={{ background: bank.color }}>{bank.short}</span>
            <span className="bank-text"><b>{bank.name}</b><small>{payingBank === bank.id ? "กำลังเปิดแอป…" : "เปิดแอป " + bank.app}</small></span>
          </button>)}</div>
          {payError && <p className="form-error" role="alert">{payError}</p>}
          <p className="bank-note">แอปธนาคารจะแสดงยอด ฿{money(order.amount)} และบัญชีเทศบาลไว้ให้แล้ว กดยืนยันได้เลย เมื่อโอนสำเร็จระบบจะบันทึกให้อัตโนมัติ ไม่ต้องส่งสลิป</p>
          <details className="alt-pay" open={!platform}>
            <summary>ไม่มีแอปธนาคารเหล่านี้? ชำระด้วย QR พร้อมเพย์แล้วส่งสลิป</summary>
            {qrFlow}
          </details>
        </> : qrFlow}
      </section>
    </div>}
  </main>;
}
