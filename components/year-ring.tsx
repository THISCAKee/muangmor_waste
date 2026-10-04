import { isDue, type MonthLine, type MonthState } from "@/lib/billing";

// The fiscal year drawn as a ring, like the municipality's round seal: October at the top,
// running clockwise to September. Each month is one segment coloured by its state; months
// picked for payment get a gold arc outside the ring. The month grid below is the labelled
// view of the same data, so the ring itself only needs native tooltips.
const STATE_LABEL: Record<MonthState, string> = {
  paid: "ชำระแล้ว", pending: "รอตรวจสอบ", unpaid: "ค้างชำระ", rejected: "ส่งสลิปใหม่", exempt: "ยกเว้น",
};

const C = 100;
const GAP = 2.4; // degrees of surface between segments

function point(radius: number, degrees: number) {
  const radians = ((degrees - 90) * Math.PI) / 180;
  return [C + radius * Math.cos(radians), C + radius * Math.sin(radians)];
}

function sector(inner: number, outer: number, start: number, end: number) {
  const [x1, y1] = point(outer, start);
  const [x2, y2] = point(outer, end);
  const [x3, y3] = point(inner, end);
  const [x4, y4] = point(inner, start);
  return `M${x1} ${y1}A${outer} ${outer} 0 0 1 ${x2} ${y2}L${x3} ${y3}A${inner} ${inner} 0 0 0 ${x4} ${y4}Z`;
}

export default function YearRing({ lines, selected, children }: { lines: MonthLine[]; selected: readonly string[]; children: React.ReactNode }) {
  const due = lines.filter((line) => isDue(line.state)).length;
  const paid = lines.filter((line) => line.state === "paid").length;
  return <div className="year-ring">
    <svg viewBox="-14 -14 228 228" role="img" aria-label={"สถานะ 12 เดือน: ชำระแล้ว " + paid + " เดือน ค้างชำระ " + due + " เดือน"}>
      {lines.map((line, index) => {
        const start = index * 30 + GAP / 2;
        const end = (index + 1) * 30 - GAP / 2;
        const tone = isDue(line.state) ? "due" : line.state;
        return <g key={line.month}>
          <path className={"ring-seg ring-" + tone} d={sector(66, 88, start, end)}><title>{line.month}: {STATE_LABEL[line.state]}</title></path>
          {selected.includes(line.month) && <path className="ring-pick" d={sector(91.5, 96, start, end)} />}
        </g>;
      })}
      {/* Where the year starts and ends, just outside the ring at 12 o'clock. */}
      {([["ต.ค.", 15], ["ก.ย.", 345]] as const).map(([label, angle]) => {
        const [x, y] = point(106, angle);
        return <text key={label} className="ring-tick" x={x} y={y} textAnchor="middle" dominantBaseline="middle">{label}</text>;
      })}
    </svg>
    <div className="year-ring-center">{children}</div>
  </div>;
}
