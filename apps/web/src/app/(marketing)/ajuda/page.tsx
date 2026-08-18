import type { Metadata } from "next";
import { Mail } from "lucide-react";
import { Faq } from "@/components/marketing/faq";

export const metadata: Metadata = { title: "Central de ajuda — Mastershopee" };

/** §80 — central de ajuda / FAQ. */
export default function AjudaPage() {
  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-tight">Central de ajuda</h1>
      <p className="mt-3 text-muted-foreground">
        Respostas rápidas para as dúvidas mais comuns. Não encontrou o que procurava? Fale com a gente.
      </p>
      <div className="mt-6 flex items-center gap-2 rounded-xl border border-border bg-card p-4 text-sm">
        <Mail className="h-4 w-4 text-primary" />
        <span>
          Suporte por e-mail:{" "}
          <a href="mailto:suporte@mastershopee.app" className="font-medium text-primary hover:underline">
            suporte@mastershopee.app
          </a>{" "}
          <span className="text-muted-foreground">(caixa de suporte a configurar em produção)</span>
        </span>
      </div>
      <div className="mt-10 -mx-6">
        <Faq />
      </div>
    </div>
  );
}
