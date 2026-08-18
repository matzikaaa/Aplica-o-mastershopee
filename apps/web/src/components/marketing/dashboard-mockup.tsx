import { ArrowUpRight, TrendingUp } from "lucide-react";

const BARS = [40, 55, 48, 62, 58, 70, 65, 78, 72, 85, 80, 92];
const CARDS = [
  { label: "Faturamento", value: "R$ 84.230", change: "+12,4%" },
  { label: "Lucro líquido", value: "R$ 21.840", change: "+18,7%" },
  { label: "Margem líquida", value: "25,9%", change: "+2,1pp" },
  { label: "ROAS", value: "5,2x", change: "+0,4x" },
];

/** Illustrative-only mockup — clearly demo data, never wired to real accounts (§75). */
export function DashboardMockup() {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-2xl shadow-primary/5">
      <div className="flex items-center justify-between border-b border-border bg-muted/40 px-5 py-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <TrendingUp className="h-4 w-4 text-primary" />
          Visão geral
          <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[11px] font-normal text-muted-foreground">
            dados de demonstração
          </span>
        </div>
        <div className="hidden gap-1 sm:flex">
          {["7 dias", "30 dias", "Este mês"].map((p, i) => (
            <span
              key={p}
              className={`rounded-md px-2.5 py-1 text-xs ${i === 1 ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
            >
              {p}
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 p-5 md:grid-cols-4">
        {CARDS.map((c) => (
          <div key={c.label} className="rounded-xl border border-border p-4">
            <p className="text-xs text-muted-foreground">{c.label}</p>
            <p className="mt-1 text-xl font-semibold">{c.value}</p>
            <p className="mt-1 flex items-center gap-0.5 text-xs font-medium text-success">
              <ArrowUpRight className="h-3 w-3" /> {c.change}
            </p>
          </div>
        ))}
      </div>

      <div className="px-5 pb-5">
        <div className="flex h-40 items-end gap-1.5 rounded-xl border border-border p-4">
          {BARS.map((h, i) => (
            <div
              key={i}
              className="flex-1 rounded-t-sm bg-gradient-to-t from-primary/70 to-primary"
              style={{ height: `${h}%` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
