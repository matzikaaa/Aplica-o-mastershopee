"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

const FAQS = [
  {
    q: "Preciso ter conta em todos os marketplaces?",
    a: "Não. Conecte apenas os marketplaces que você já usa — Shopee, Mercado Livre, SHEIN e/ou TikTok Shop. Você pode adicionar mais depois.",
  },
  {
    q: "Como vocês calculam o lucro líquido?",
    a: "Partimos do faturamento e descontamos comissões, taxas do marketplace, frete subsidiado, ADS, custo do produto, impostos e devoluções — cada valor é somado a partir de dados reais das APIs oficiais e do custo que você cadastra. Você pode ver o detalhamento completo de qualquer pedido.",
  },
  {
    q: "Vocês têm acesso à minha conta bancária?",
    a: "Não. A Mastershopee só lê dados de vendas, taxas e anúncios através das APIs oficiais dos marketplaces (OAuth). Nunca solicitamos senha de banco.",
  },
  {
    q: "O resumo diário no WhatsApp é automático?",
    a: "Sim, a partir do plano Pro. Você escolhe o horário e recebe faturamento, lucro, margem e alertas todos os dias via WhatsApp Business Platform (API oficial da Meta).",
  },
  {
    q: "Posso cancelar quando quiser?",
    a: "Sim, não há fidelidade. Você pode cancelar a qualquer momento diretamente no painel de Assinatura.",
  },
];

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" className="bg-muted/30 px-6 py-24">
      <div className="mx-auto max-w-3xl">
        <div className="mb-12 text-center">
          <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-primary">FAQ</p>
          <h2 className="text-3xl font-semibold tracking-tight">Perguntas frequentes</h2>
        </div>
        <div className="space-y-3">
          {FAQS.map((item, i) => (
            <div key={item.q} className="rounded-xl border border-border bg-card">
              <button
                className="flex w-full items-center justify-between gap-4 p-5 text-left"
                onClick={() => setOpen(open === i ? null : i)}
              >
                <span className="font-medium">{item.q}</span>
                <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open === i && "rotate-180")} />
              </button>
              {open === i && <p className="px-5 pb-5 text-sm text-muted-foreground animate-fade-in">{item.a}</p>}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
