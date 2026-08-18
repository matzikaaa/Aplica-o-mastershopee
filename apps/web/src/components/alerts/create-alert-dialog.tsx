"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label, Select, Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

const RULE_TYPES = [
  { value: "NEGATIVE_MARGIN_PRODUCT", label: "Produto com margem negativa" },
  { value: "AD_SPEND_THRESHOLD", label: "Gasto com ADS acima de um valor" },
  { value: "NET_MARGIN_BELOW", label: "Margem líquida abaixo de um percentual" },
  { value: "MARKETPLACE_SYNC_FAILED", label: "Marketplace parou de sincronizar" },
  { value: "DAILY_REVENUE_ABOVE", label: "Faturamento diário acima de um valor" },
];

export function CreateAlertDialog() {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState(RULE_TYPES[0]!.value);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { push } = useToast();

  async function handleSubmit(formData: FormData) {
    setLoading(true);
    const threshold = formData.get("threshold");
    const res = await fetch("/api/alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type,
        severity: formData.get("severity"),
        config: threshold ? { threshold: Number(threshold) } : {},
        channels: ["in_app"],
        isActive: true,
      }),
    });
    setLoading(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      push({ type: "error", title: "Não foi possível criar o alerta.", description: body?.error });
      return;
    }
    push({ type: "success", title: "Alerta criado" });
    setOpen(false);
    router.refresh();
  }

  const needsThreshold = type === "AD_SPEND_THRESHOLD" || type === "NET_MARGIN_BELOW" || type === "DAILY_REVENUE_ABOVE";

  return (
    <>
      <Button size="sm" className="gap-2" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> Novo alerta
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Novo alerta" description="Seja avisado automaticamente quando uma condição acontecer.">
        <form action={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="type">Condição</Label>
            <Select id="type" value={type} onChange={(e) => setType(e.target.value)}>
              {RULE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </div>
          {needsThreshold && (
            <div className="space-y-1.5">
              <Label htmlFor="threshold">Valor limite</Label>
              <Input id="threshold" name="threshold" type="number" step="0.01" required />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="severity">Severidade</Label>
            <Select id="severity" name="severity" defaultValue="IMPORTANT">
              <option value="CRITICAL">Crítico</option>
              <option value="IMPORTANT">Importante</option>
              <option value="INFORMATIVE">Informativo</option>
            </Select>
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Criando..." : "Criar alerta"}
          </Button>
        </form>
      </Dialog>
    </>
  );
}
