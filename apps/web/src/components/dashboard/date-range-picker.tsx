"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import type { DateRangePreset } from "@mastershopee/shared";
import { cn } from "@/lib/utils";

const PRESETS: { value: DateRangePreset; label: string }[] = [
  { value: "today", label: "Hoje" },
  { value: "yesterday", label: "Ontem" },
  { value: "last_7_days", label: "Últimos 7 dias" },
  { value: "last_30_days", label: "Últimos 30 dias" },
  { value: "this_month", label: "Este mês" },
  { value: "last_month", label: "Mês passado" },
  { value: "all_time", label: "Desde o início" },
];

/** §10 — period filter that drives every KPI/chart on the page via the `period` search param. */
export function DateRangePicker({ current }: { current: DateRangePreset }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function setPeriod(value: DateRangePreset) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("period", value);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-muted p-1">
      {PRESETS.map((p) => (
        <button
          key={p.value}
          onClick={() => setPeriod(p.value)}
          className={cn(
            "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            current === p.value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
