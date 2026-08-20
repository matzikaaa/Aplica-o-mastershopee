"use client";

import { useState } from "react";
import { Boxes, Megaphone, ShoppingCart } from "lucide-react";
import { ADS_IMPORT_FIELDS, ORDER_IMPORT_FIELDS, PRODUCT_IMPORT_FIELDS } from "@mastershopee/shared";
import { ImportWizard } from "./import-wizard";
import { cn } from "@/lib/utils";

type Tab = "products" | "orders" | "ads";

const TABS: { id: Tab; label: string; icon: typeof Boxes }[] = [
  { id: "products", label: "Produtos e estoque", icon: Boxes },
  { id: "orders", label: "Pedidos", icon: ShoppingCart },
  { id: "ads", label: "Anúncios", icon: Megaphone },
];

export function ImportTabs() {
  const [tab, setTab] = useState<Tab>("products");

  return (
    <div className="space-y-6">
      <div className="flex gap-1 rounded-lg bg-muted p-1">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            aria-pressed={tab === id}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition",
              tab === id ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === "products" && (
        <ImportWizard
          fields={PRODUCT_IMPORT_FIELDS}
          endpoint="/api/import/products"
          title="Produtos, custos e estoque"
          description="Cada linha é um produto. O estoque informado passa a ser o saldo atual — reimportar com valores corrigidos ajusta, não soma."
        />
      )}

      {tab === "orders" && (
        <ImportWizard
          fields={ORDER_IMPORT_FIELDS}
          endpoint="/api/import/orders"
          needsMarketplace
          title="Histórico de pedidos"
          description="Cada linha é um item vendido. Vários itens do mesmo pedido podem repetir o número do pedido. O estoque não é debitado: são vendas passadas, já refletidas no saldo que você informou."
        />
      )}

      {tab === "ads" && (
        <ImportWizard
          fields={ADS_IMPORT_FIELDS}
          endpoint="/api/import/ads"
          needsMarketplace
          title="Gastos com anúncios"
          description="Cada linha é uma campanha num dia. Reimportar um período que se sobrepõe corrige os dias cobertos em vez de somar em cima."
        />
      )}
    </div>
  );
}
