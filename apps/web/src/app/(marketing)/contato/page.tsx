import type { Metadata } from "next";
import { Mail } from "lucide-react";

export const metadata: Metadata = { title: "Contato — Mastershopee" };

export default function ContatoPage() {
  return (
    <article className="space-y-4">
      <h1 className="text-3xl font-semibold tracking-tight">Fale com a gente</h1>
      <p className="text-muted-foreground">
        Dúvidas sobre planos, integrações ou algo não funcionando como esperado? Escreva para nós.
      </p>
      <div className="flex items-center gap-2 rounded-xl border border-border bg-card p-4 text-sm">
        <Mail className="h-4 w-4 text-primary" />
        <a href="mailto:suporte@mastershopee.app" className="font-medium text-primary hover:underline">
          suporte@mastershopee.app
        </a>
      </div>
      <p className="text-xs text-muted-foreground">
        Caixa de e-mail de suporte a ser configurada em produção — este endereço é um placeholder.
      </p>
    </article>
  );
}
