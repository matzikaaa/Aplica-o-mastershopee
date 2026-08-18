"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

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
  disabled,
}: {
  phoneNumber?: string;
  dailyReportTime?: string;
  dailyReportEnabled?: boolean;
  disabled?: boolean;
}) {
  const { submit, loading } = useSimplePost("/api/settings/whatsapp", "WhatsApp configurado");
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
      <Button type="submit" disabled={loading || disabled}>
        {loading ? "Salvando..." : "Salvar"}
      </Button>
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
