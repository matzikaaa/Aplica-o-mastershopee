"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { MARKETPLACE_LABELS, type MarketplaceType } from "@mastershopee/shared";
import { cn } from "@/lib/utils";

/** §11 — "Todos" consolidates every connected marketplace; otherwise filters to one. */
export function MarketplaceFilter({ current }: { current: MarketplaceType | "all" }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function setMarketplace(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("marketplace", value);
    router.push(`${pathname}?${params.toString()}`);
  }

  const options: { value: MarketplaceType | "all"; label: string }[] = [
    { value: "all", label: "Todos" },
    ...(Object.keys(MARKETPLACE_LABELS) as MarketplaceType[]).map((m) => ({ value: m, label: MARKETPLACE_LABELS[m] })),
  ];

  return (
    <div className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-muted p-1">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => setMarketplace(o.value)}
          className={cn(
            "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            current === o.value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
