"use client";

import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { requestPasswordResetSchema, type RequestPasswordResetInput } from "@mastershopee/shared";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Mail } from "lucide-react";

type FormValues = RequestPasswordResetInput;

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(requestPasswordResetSchema) });

  async function onSubmit(data: FormValues) {
    setLoading(true);
    await fetch("/api/auth/request-password-reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    setLoading(false);
    setSent(true);
  }

  if (sent) {
    return (
      <AuthShell title="Verifique seu e-mail">
        <div className="flex flex-col items-center gap-3 text-center">
          <Mail className="h-10 w-10 text-primary" />
          <p className="text-sm text-muted-foreground">
            Se este e-mail estiver cadastrado, você receberá um link para redefinir sua senha.
          </p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Esqueceu sua senha?"
      description="Informe seu e-mail e enviaremos um link de redefinição"
      footer={
        <Link href="/login" className="font-medium text-primary hover:underline">
          Voltar para o login
        </Link>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">E-mail</Label>
          <Input id="email" type="email" placeholder="voce@empresa.com" {...register("email")} />
          {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
        </div>
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Enviando..." : "Enviar link de redefinição"}
        </Button>
      </form>
    </AuthShell>
  );
}
