"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Package,
  Receipt,
  ShoppingCart,
  Megaphone,
  Wallet,
  FileBarChart,
  Bell,
  Plug,
  Settings,
  CreditCard,
  HelpCircle,
  TrendingUp,
  Lightbulb,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Visão Geral", icon: LayoutDashboard },
  { href: "/orders", label: "Pedidos", icon: ShoppingCart },
  { href: "/products", label: "Produtos", icon: Package },
  { href: "/costs", label: "Custos", icon: Receipt },
  { href: "/ads", label: "Publicidade", icon: Megaphone },
  { href: "/financial", label: "Financeiro", icon: Wallet },
  { href: "/insights", label: "Insights", icon: Lightbulb },
  { href: "/reports", label: "Relatórios", icon: FileBarChart },
  { href: "/alerts", label: "Alertas", icon: Bell },
  { href: "/integrations", label: "Integrações", icon: Plug },
];

const NAV_BOTTOM = [
  { href: "/settings", label: "Configurações", icon: Settings },
  { href: "/subscription", label: "Assinatura", icon: CreditCard },
  { href: "/ajuda", label: "Ajuda", icon: HelpCircle },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-card md:flex">
      <div className="flex h-16 items-center gap-2 px-5 font-semibold">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <TrendingUp className="h-4.5 w-4.5" />
        </span>
        Mastershopee
      </div>
      <nav className="flex-1 space-y-1 px-3 py-2">
        {NAV.map((item) => {
          const active = pathname?.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="space-y-1 border-t border-border px-3 py-3">
        {NAV_BOTTOM.map((item) => {
          const active = pathname?.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </div>
    </aside>
  );
}
