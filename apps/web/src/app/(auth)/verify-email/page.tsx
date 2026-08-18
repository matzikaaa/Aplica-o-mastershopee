"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";
import { buttonVariants } from "@/components/ui/button";

function VerifyEmailInner() {
  const token = useSearchParams().get("token");
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");

  useEffect(() => {
    if (!token) {
      setStatus("error");
      return;
    }
    fetch("/api/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then((res) => setStatus(res.ok ? "success" : "error"))
      .catch(() => setStatus("error"));
  }, [token]);

  return (
    <AuthShell title="Confirmação de e-mail">
      <div className="flex flex-col items-center gap-4 text-center">
        {status === "loading" && <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />}
        {status === "success" && (
          <>
            <CheckCircle2 className="h-10 w-10 text-success" />
            <p className="text-sm text-muted-foreground">E-mail confirmado! Você já pode entrar na sua conta.</p>
            <Link href="/login" className={buttonVariants({ className: "w-full" })}>
              Entrar
            </Link>
          </>
        )}
        {status === "error" && (
          <>
            <XCircle className="h-10 w-10 text-destructive" />
            <p className="text-sm text-muted-foreground">Link inválido ou expirado. Tente se cadastrar novamente.</p>
            <Link href="/register" className={buttonVariants({ variant: "outline", className: "w-full" })}>
              Voltar ao cadastro
            </Link>
          </>
        )}
      </div>
    </AuthShell>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmailInner />
    </Suspense>
  );
}
