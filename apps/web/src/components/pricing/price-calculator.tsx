"use client";

import { useMemo, useState } from "react";
import { Calculator, Package, Plus, Trash2, Info } from "lucide-react";
import Decimal from "decimal.js";
import { suggestPrice, simulatePrice, calculatePackagingCost } from "@mastershopee/financial-engine";
import { MARKETPLACE_LABELS, type MarketplaceType } from "@mastershopee/shared";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface MarketplaceRateOption {
  marketplace: MarketplaceType;
  /** null when the workspace has no sales history for this marketplace. */
  rates: {
    commissionPercent: string;
    marketplaceFeePercent: string;
    taxPercent: string;
    adSpendPercent: string;
    sampleOrders: number;
    periodDays: number;
  } | null;
}

const MARKETPLACES: MarketplaceType[] = ["SHOPEE", "MERCADO_LIVRE", "SHEIN", "TIKTOK_SHOP"];

interface PackagingRow {
  id: string;
  name: string;
  packPrice: string;
  unitsPerPack: string;
  unitsUsed: string;
}

function newRow(name = ""): PackagingRow {
  return { id: Math.random().toString(36).slice(2), name, packPrice: "", unitsPerPack: "", unitsUsed: "1" };
}

const num = (v: string) => (v.trim() === "" ? 0 : Number(v.replace(",", ".")) || 0);
const brl = (v: Decimal | string | number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v.toString()));

export function PriceCalculator({ options }: { options: MarketplaceRateOption[] }) {
  const [marketplace, setMarketplace] = useState<MarketplaceType>("SHOPEE");
  const [tab, setTab] = useState<"price" | "packaging">("price");
  const [mode, setMode] = useState<"margin" | "price">("margin");

  const selected = options.find((o) => o.marketplace === marketplace);

  // Rates start from what this marketplace actually charged, and stay editable.
  const [commission, setCommission] = useState("");
  const [fee, setFee] = useState("");
  const [tax, setTax] = useState("");
  const [ads, setAds] = useState("");
  const [ratesTouched, setRatesTouched] = useState(false);

  const effective = selected?.rates ?? null;
  const commissionValue = ratesTouched ? commission : (effective?.commissionPercent ?? "");
  const feeValue = ratesTouched ? fee : (effective?.marketplaceFeePercent ?? "");
  const taxValue = ratesTouched ? tax : (effective?.taxPercent ?? "");
  const adsValue = ratesTouched ? ads : (effective?.adSpendPercent ?? "");

  function switchMarketplace(m: MarketplaceType) {
    setMarketplace(m);
    // Re-seed from the newly selected marketplace's own history.
    setRatesTouched(false);
  }

  function touchRates(setter: (v: string) => void, value: string) {
    if (!ratesTouched) {
      setCommission(effective?.commissionPercent ?? "");
      setFee(effective?.marketplaceFeePercent ?? "");
      setTax(effective?.taxPercent ?? "");
      setAds(effective?.adSpendPercent ?? "");
      setRatesTouched(true);
    }
    setter(value);
  }

  const [unitCost, setUnitCost] = useState("");
  const [otherCosts, setOtherCosts] = useState("");
  const [desiredMargin, setDesiredMargin] = useState("25");
  const [salePrice, setSalePrice] = useState("");

  const [rows, setRows] = useState<PackagingRow[]>([newRow("Saco/caixa")]);
  const [packagingApplied, setPackagingApplied] = useState(false);
  const [packagingManual, setPackagingManual] = useState("");

  const packaging = useMemo(() => {
    const usable = rows.filter((r) => num(r.unitsPerPack) > 0 && r.packPrice.trim() !== "");
    if (usable.length === 0) return null;
    try {
      return calculatePackagingCost(
        usable.map((r) => ({
          name: r.name || "Item",
          packPrice: num(r.packPrice),
          unitsPerPack: num(r.unitsPerPack),
          unitsUsed: num(r.unitsUsed) || 1,
        })),
      );
    } catch {
      return null;
    }
  }, [rows]);

  const packagingCost = packagingApplied && packaging ? packaging.totalPerShipment.toFixed(4) : num(packagingManual);

  const result = useMemo(() => {
    const base = {
      unitCost: num(unitCost),
      packagingCost,
      otherCosts: num(otherCosts),
      commissionPercent: num(commissionValue),
      marketplaceFeePercent: num(feeValue),
      taxPercent: num(taxValue),
      estimatedAdSpendPercent: num(adsValue),
    };
    try {
      if (mode === "margin") {
        return { ok: true as const, kind: "margin" as const, data: suggestPrice({ ...base, desiredMarginPercent: num(desiredMargin) }) };
      }
      if (num(salePrice) <= 0) return null;
      return { ok: true as const, kind: "price" as const, data: simulatePrice({ ...base, price: num(salePrice) }) };
    } catch (err) {
      return { ok: false as const, message: err instanceof Error ? err.message : "Não foi possível calcular." };
    }
  }, [unitCost, packagingCost, otherCosts, commissionValue, feeValue, taxValue, adsValue, desiredMargin, salePrice, mode]);

  return (
    <div className="space-y-6">
      {/* Marketplace picker */}
      <div className="grid gap-3 sm:grid-cols-4">
        {MARKETPLACES.map((m) => {
          const opt = options.find((o) => o.marketplace === m);
          const active = m === marketplace;
          return (
            <button
              key={m}
              type="button"
              onClick={() => switchMarketplace(m)}
              aria-pressed={active}
              className={cn(
                "rounded-xl border px-4 py-3 text-left transition",
                active ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border bg-card hover:border-primary/50",
              )}
            >
              <div className="text-sm font-medium">{MARKETPLACE_LABELS[m]}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {opt?.rates
                  ? `${Number(opt.rates.commissionPercent).toFixed(1)}% de comissão`
                  : "sem histórico"}
              </div>
            </button>
          );
        })}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg bg-muted p-1">
        <TabButton active={tab === "price"} onClick={() => setTab("price")} icon={Calculator}>
          Preço de venda
        </TabButton>
        <TabButton active={tab === "packaging"} onClick={() => setTab("packaging")} icon={Package}>
          Embalagem
        </TabButton>
      </div>

      {tab === "packaging" ? (
        <PackagingTab
          rows={rows}
          setRows={setRows}
          packaging={packaging}
          onApply={() => {
            setPackagingApplied(true);
            setTab("price");
          }}
          applied={packagingApplied}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
          <div className="space-y-6">
            <Section title="Custos do produto">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Custo unitário (R$)" value={unitCost} onChange={setUnitCost} placeholder="0,00" />
                <div className="space-y-1.5">
                  <Label htmlFor="pack">Embalagem (R$)</Label>
                  <Input
                    id="pack"
                    inputMode="decimal"
                    value={packagingApplied && packaging ? packaging.totalPerShipment.toFixed(2) : packagingManual}
                    onChange={(e) => {
                      setPackagingApplied(false);
                      setPackagingManual(e.target.value);
                    }}
                    placeholder="0,00"
                  />
                  {packagingApplied && packaging && (
                    <p className="text-xs text-success">Calculado na aba Embalagem.</p>
                  )}
                </div>
                <Field label="Outros custos (R$)" value={otherCosts} onChange={setOtherCosts} placeholder="0,00" />
              </div>
            </Section>

            <Section
              title="Descontos do marketplace"
              hint={
                effective
                  ? `Preenchido com o que a ${MARKETPLACE_LABELS[marketplace]} realmente cobrou nos seus últimos ${effective.periodDays} dias (${effective.sampleOrders} pedidos). Edite se sua categoria tiver taxa diferente.`
                  : `Sem histórico de vendas na ${MARKETPLACE_LABELS[marketplace]} ainda — informe as taxas do seu contrato. Não usamos tabela genérica de comissão porque ela varia por categoria.`
              }
            >
              <div className="grid gap-3 sm:grid-cols-4">
                <Field label="Comissão (%)" value={commissionValue} onChange={(v) => touchRates(setCommission, v)} placeholder="0" />
                <Field label="Taxa fixa (%)" value={feeValue} onChange={(v) => touchRates(setFee, v)} placeholder="0" />
                <Field label="Imposto (%)" value={taxValue} onChange={(v) => touchRates(setTax, v)} placeholder="0" />
                <Field label="ADS (%)" value={adsValue} onChange={(v) => touchRates(setAds, v)} placeholder="0" />
              </div>
            </Section>

            <Section title="O que você quer descobrir">
              <div className="flex gap-1 rounded-lg bg-muted p-1">
                <TabButton active={mode === "margin"} onClick={() => setMode("margin")}>
                  Quero X% de margem
                </TabButton>
                <TabButton active={mode === "price"} onClick={() => setMode("price")}>
                  Vou vender por R$ Y
                </TabButton>
              </div>
              <div className="mt-3 max-w-xs">
                {mode === "margin" ? (
                  <Field label="Margem desejada (%)" value={desiredMargin} onChange={setDesiredMargin} placeholder="25" />
                ) : (
                  <Field label="Preço de venda (R$)" value={salePrice} onChange={setSalePrice} placeholder="59,90" />
                )}
              </div>
            </Section>
          </div>

          <ResultPanel result={result} mode={mode} />
        </div>
      )}
    </div>
  );
}

type CalcResult =
  | { ok: true; kind: "margin"; data: ReturnType<typeof suggestPrice> }
  | { ok: true; kind: "price"; data: ReturnType<typeof simulatePrice> }
  | { ok: false; message: string };

function ResultPanel({ result, mode }: { result: CalcResult | null; mode: "margin" | "price" }) {
  if (!result) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">
          Informe o preço de venda para ver o resultado.
        </CardContent>
      </Card>
    );
  }

  if (!result.ok) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-destructive">{result.message}</p>
        </CardContent>
      </Card>
    );
  }

  // Narrow on result.kind, never on `mode`: the result is memoized, so a
  // render can briefly carry the previous mode's shape while the new one is
  // still being computed.
  const profit = Number(result.data.estimatedProfit.toFixed(2));
  const margin = Number(result.data.estimatedMarginPercent.toString());
  const isMargin = result.kind === "margin";

  return (
    <Card className="h-fit lg:sticky lg:top-6">
      <CardContent className="space-y-5 pt-6">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {isMargin ? "Preço recomendado" : "Lucro por venda"}
          </p>
          <p
            className={cn(
              "mt-1 text-4xl font-semibold tabular-nums tracking-tight",
              !isMargin && profit < 0 && "text-destructive",
            )}
          >
            {result.kind === "margin" ? brl(result.data.recommendedPrice.toFixed(2)) : brl(profit)}
          </p>
          {isMargin ? (
            <p className="mt-1 text-sm text-muted-foreground">
              Lucro estimado: <span className="font-medium text-foreground">{brl(profit)}</span> ({margin.toFixed(2)}%)
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">
              Margem: <span className={cn("font-medium", margin < 0 ? "text-destructive" : "text-foreground")}>{margin.toFixed(2)}%</span>
            </p>
          )}
        </div>

        <div className="space-y-2 border-t border-border pt-4 text-sm">
          <Row label="Custos fixos por unidade" value={brl(result.data.fixedCosts.toFixed(2))} />
          {result.kind === "margin" ? (
            <>
              <Row
                label="Descontos percentuais"
                value={`${Number(result.data.percentualDeductionsPercent.toString()).toFixed(2)}%`}
              />
              <Row label="Preço mínimo (lucro zero)" value={brl(result.data.minimumPrice.toFixed(2))} muted />
            </>
          ) : (
            <Row label="Descontos do marketplace" value={brl(result.data.percentualDeductions.toFixed(2))} />
          )}
        </div>

        {!isMargin && profit < 0 && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            Neste preço você perde dinheiro em cada venda.
          </div>
        )}

        <div className="flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>
            Estimativa: o gasto com ADS é uma média do seu histórico, não um valor fixo por venda. Frete não entra
            aqui — varia por destino e regra de subsídio.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function PackagingTab({
  rows,
  setRows,
  packaging,
  onApply,
  applied,
}: {
  rows: PackagingRow[];
  setRows: (r: PackagingRow[]) => void;
  packaging: ReturnType<typeof calculatePackagingCost> | null;
  onApply: () => void;
  applied: boolean;
}) {
  function update(id: string, patch: Partial<PackagingRow>) {
    setRows(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  return (
    <div className="space-y-4">
      <Section
        title="Componentes da embalagem"
        hint="Embalagem se compra em pacote e se usa por unidade. Informe o que pagou e quantas unidades vieram — o custo por envio sai daqui."
      >
        <div className="space-y-3">
          {rows.map((row) => (
            <div key={row.id} className="grid gap-2 sm:grid-cols-[1.4fr_1fr_1fr_1fr_auto]">
              <Input placeholder="Ex.: Caixa 20x15" value={row.name} onChange={(e) => update(row.id, { name: e.target.value })} />
              <Input placeholder="Preço do pacote" inputMode="decimal" value={row.packPrice} onChange={(e) => update(row.id, { packPrice: e.target.value })} />
              <Input placeholder="Un. no pacote" inputMode="numeric" value={row.unitsPerPack} onChange={(e) => update(row.id, { unitsPerPack: e.target.value })} />
              <Input placeholder="Usa por envio" inputMode="numeric" value={row.unitsUsed} onChange={(e) => update(row.id, { unitsUsed: e.target.value })} />
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={`Remover ${row.name || "item"}`}
                onClick={() => setRows(rows.filter((r) => r.id !== row.id))}
                disabled={rows.length <= 1}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>

        <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => setRows([...rows, newRow()])}>
          <Plus className="mr-1.5 h-4 w-4" />
          Adicionar componente
        </Button>
      </Section>

      {packaging && (
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-1.5 text-sm">
              {packaging.lines.map((line) => (
                <div key={line.name} className="flex justify-between text-muted-foreground">
                  <span>
                    {line.name} — {brl(line.costPerUnit.toFixed(4))}/un. × {line.unitsUsed.toString()}
                  </span>
                  <span className="tabular-nums">{brl(line.subtotal.toFixed(2))}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Custo por envio</p>
                <p className="mt-0.5 text-3xl font-semibold tabular-nums tracking-tight">
                  {brl(packaging.totalPerShipment.toFixed(2))}
                </p>
              </div>
              <Button type="button" onClick={onApply}>
                {applied ? "Aplicado ✓" : "Usar na calculadora"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-sm font-semibold">{title}</h2>
      {hint && <p className="mb-3 mt-1 text-xs text-muted-foreground">{hint}</p>}
      <div className={hint ? "" : "mt-3"}>{children}</div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const id = label.replace(/\W/g, "");
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition",
        active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {Icon && <Icon className="h-4 w-4" />}
      {children}
    </button>
  );
}

function Row({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={cn("flex justify-between", muted && "text-muted-foreground")}>
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
