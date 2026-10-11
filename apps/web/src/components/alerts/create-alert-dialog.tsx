"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label, Select, Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { ALERT_RULE_LABELS } from "@mastershopee/shared";

const RULE_TYPES = Object.entries(ALERT_RULE_LABELS).map(([value, label]) => ({ value, label }));

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
              {/* Um campo só para percentual e para reais: sem a unidade, "10"
                  tanto pode ser 10% quanto R$ 10,00. */}
              <Label htmlFor="threshold">{type === "NET_MARGIN_BELOW" ? "Margem mínima (%)" : "Valor limite (R$)"}</Label>
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
