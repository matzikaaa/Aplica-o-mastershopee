"use client";

import { useState } from "react";
import { Boxes, Megaphone, ScanSearch, ShoppingCart } from "lucide-react";
import {
  ADS_IMPORT_FIELDS,
  ORDER_IMPORT_FIELDS,
  PRODUCT_IMPORT_FIELDS,
  SKU_DISCOVERY_FIELDS,
} from "@mastershopee/shared";
import { ImportWizard } from "./import-wizard";
import { cn } from "@/lib/utils";

type Tab = "skus" | "products" | "orders" | "ads";

const TABS: { id: Tab; label: string; icon: typeof Boxes }[] = [
  { id: "skus", label: "Descobrir SKUs", icon: ScanSearch },
  { id: "products", label: "Produtos e estoque", icon: Boxes },
  { id: "orders", label: "Pedidos", icon: ShoppingCart },
  { id: "ads", label: "Anúncios", icon: Megaphone },
];

export function ImportTabs() {
  const [tab, setTab] = useState<Tab>("skus");

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1 rounded-lg bg-muted p-1 sm:flex-row">
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

      {tab === "skus" && (
        <ImportWizard
          fields={SKU_DISCOVERY_FIELDS}
          endpoint="/api/import/skus"
          title="Montar o catálogo a partir dos seus relatórios"
          description="Suba qualquer relatório que tenha a coluna de SKU — pedidos, anúncios, estoque do marketplace. Lemos só os SKUs, sem repetir os que se repetem, e cadastramos cada um como produto sem custo. Nenhuma venda é gravada aqui."
          nextStep={{ href: "/costs", label: "Preencher custos" }}
        />
      )}

      {tab === "products" && (
        <ImportWizard
          fields={PRODUCT_IMPORT_FIELDS}
          endpoint="/api/import/products"
          title="Produtos, custos e estoque"
          description="Cada linha é um produto. O estoque informado passa a ser o saldo atual — reimportar com valores corrigidos ajusta, não soma."
          nextStep={{ href: "/costs", label: "Ver custos" }}
        />
      )}

      {tab === "orders" && (
        <ImportWizard
          fields={ORDER_IMPORT_FIELDS}
          endpoint="/api/import/orders"
          needsMarketplace
          title="Histórico de pedidos"
          description="Cada linha é um item vendido. Vários itens do mesmo pedido podem repetir o número do pedido. O estoque não é debitado: são vendas passadas, já refletidas no saldo que você informou."
          nextStep={{ href: "/dashboard", label: "Ver o resultado" }}
        />
      )}

      {tab === "ads" && (
        <ImportWizard
          fields={ADS_IMPORT_FIELDS}
          endpoint="/api/import/ads"
          needsMarketplace
          title="Gastos com anúncios"
          description="Cada linha é uma campanha num dia. Reimportar um período que se sobrepõe corrige os dias cobertos em vez de somar em cima."
          nextStep={{ href: "/ads", label: "Ver anúncios" }}
        />
      )}
    </div>
  );
}
