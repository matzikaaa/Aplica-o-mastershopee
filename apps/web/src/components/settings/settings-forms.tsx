"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

function useSimplePost(url: string, successMessage: string) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { push } = useToast();

  async function submit(payload: Record<string, unknown>): Promise<void> {
    setLoading(true);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setLoading(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      push({ type: "error", title: "Não foi possível salvar", description: body?.error });
      return;
    }
    push({ type: "success", title: successMessage });
    router.refresh();
  }

  return { submit, loading };
}

export function ProfileForm({ name }: { name: string }) {
  const { submit, loading } = useSimplePost("/api/settings/profile", "Perfil atualizado");
  return (
    <form
      action={(fd) => submit({ name: fd.get("name") })}
      className="max-w-sm space-y-4"
    >
      <div className="space-y-1.5">
        <Label htmlFor="name">Nome completo</Label>
        <Input id="name" name="name" defaultValue={name} required />
      </div>
      <Button type="submit" disabled={loading}>
        {loading ? "Salvando..." : "Salvar"}
      </Button>
    </form>
  );
}

export function WorkspaceForm({ name, timezone }: { name: string; timezone: string }) {
  const { submit, loading } = useSimplePost("/api/settings/workspace", "Empresa atualizada");
  return (
    <form action={(fd) => submit({ name: fd.get("name"), timezone: fd.get("timezone") })} className="max-w-sm space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="wname">Nome da empresa</Label>
        <Input id="wname" name="name" defaultValue={name} required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="timezone">Fuso horário</Label>
        <Select id="timezone" name="timezone" defaultValue={timezone}>
          <option value="America/Sao_Paulo">América/São Paulo (BRT)</option>
          <option value="America/Manaus">América/Manaus</option>
          <option value="America/Recife">América/Recife</option>
          <option value="America/Fortaleza">América/Fortaleza</option>
        </Select>
      </div>
      <Button type="submit" disabled={loading}>
        {loading ? "Salvando..." : "Salvar"}
      </Button>
    </form>
  );
}

export function WhatsAppForm({
  phoneNumber,
  dailyReportTime,
  dailyReportEnabled,
  verified,
  disabled,
}: {
  phoneNumber?: string;
  dailyReportTime?: string;
  dailyReportEnabled?: boolean;
  verified?: boolean;
  disabled?: boolean;
}) {
  const { submit, loading } = useSimplePost("/api/settings/whatsapp", "WhatsApp configurado");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const router = useRouter();

  async function sendTest() {
    setTesting(true);
    setTestResult(null);
    const res = await fetch("/api/settings/whatsapp/test", { method: "POST" });
    const data = await res.json();
    setTesting(false);
    setTestResult(
      res.ok
        ? {
            ok: true,
            message:
              data.via === "template"
                ? "Mensagem enviada pelo template aprovado. Confira o celular — os alertas estão ativos."
                : "Mensagem enviada como texto livre. Funciona só dentro da janela de 24h; para o resumo diário funcionar, cadastre um template aprovado.",
          }
        : { ok: false, message: data.error ?? "Falha no envio." },
    );
    router.refresh();
  }
  return (
    <form
      action={(fd) =>
        submit({
          phoneNumber: fd.get("phoneNumber"),
          dailyReportTime: fd.get("dailyReportTime"),
          dailyReportEnabled: fd.get("dailyReportEnabled") === "on",
        })
      }
      className="max-w-sm space-y-4"
    >
      {disabled && (
        <p className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">
          Recurso disponível a partir do plano Pro.
        </p>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="phoneNumber">Número do WhatsApp</Label>
        <Input id="phoneNumber" name="phoneNumber" placeholder="+55 11 99999-9999" defaultValue={phoneNumber} disabled={disabled} required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="dailyReportTime">Horário do resumo diário</Label>
        <Input id="dailyReportTime" name="dailyReportTime" type="time" defaultValue={dailyReportTime ?? "07:30"} disabled={disabled} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="dailyReportEnabled" defaultChecked={dailyReportEnabled} disabled={disabled} />
        Enviar resumo diário automaticamente
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={loading || disabled}>
          {loading ? "Salvando..." : "Salvar"}
        </Button>
        <Button type="button" variant="outline" onClick={sendTest} disabled={testing || disabled || !phoneNumber}>
          {testing ? "Enviando..." : "Enviar mensagem de teste"}
        </Button>
      </div>

      {/* The scheduler only sends to verified configurations, so this state is
          the difference between "set up" and "actually working" — it is shown
          rather than assumed. */}
      <p className="text-xs text-muted-foreground">
        {verified ? (
          <span className="text-success">✓ Número verificado — os alertas serão enviados.</span>
        ) : (
          <>
            ⚠ Número ainda não verificado. Nenhum alerta é enviado até um teste chegar de verdade ao seu celular.
          </>
        )}
      </p>

      {testResult && (
        <p
          className={cn(
            "rounded-lg border px-3 py-2 text-xs",
            testResult.ok
              ? "border-success/30 bg-success/10"
              : "border-destructive/30 bg-destructive/10 text-destructive",
          )}
        >
          {testResult.message}
        </p>
      )}
    </form>
  );
}

export function PasswordForm() {
  const { submit, loading } = useSimplePost("/api/settings/password", "Senha alterada");
  return (
    <form
      action={(fd) => submit({ currentPassword: fd.get("currentPassword"), newPassword: fd.get("newPassword") })}
      className="max-w-sm space-y-4"
    >
      <div className="space-y-1.5">
        <Label htmlFor="currentPassword">Senha atual</Label>
        <Input id="currentPassword" name="currentPassword" type="password" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="newPassword">Nova senha</Label>
        <Input id="newPassword" name="newPassword" type="password" required />
      </div>
      <Button type="submit" disabled={loading}>
        {loading ? "Salvando..." : "Alterar senha"}
      </Button>
    </form>
  );
}
