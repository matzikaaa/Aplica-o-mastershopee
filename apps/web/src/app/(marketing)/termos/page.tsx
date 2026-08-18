import type { Metadata } from "next";
import { AlertTriangle } from "lucide-react";

export const metadata: Metadata = { title: "Termos de uso — Mastershopee" };

/**
 * §79: this is deliberately a skeleton, not finished legal copy. The brief
 * explicitly warns against presenting unreviewed legal content as final —
 * the section headings below are the structure a real Termos de Uso needs
 * for a Brazilian SaaS handling seller financial data, but the actual
 * clauses require legal review before this page is contractually binding.
 */
export default function TermosPage() {
  return (
    <article>
      <h1 className="text-3xl font-semibold tracking-tight text-foreground">Termos de Uso</h1>

      <div className="my-6 flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <p className="text-foreground">
          <strong>Este documento está em elaboração.</strong> A estrutura abaixo reflete as seções que um
          Termos de Uso para este produto normalmente precisa cobrir, mas o conteúdo ainda não foi revisado
          por um profissional jurídico e não deve ser considerado vinculante até essa revisão.
        </p>
      </div>

      <div className="space-y-6 text-sm text-muted-foreground">
        <section>
          <h2 className="text-base font-semibold text-foreground">1. Objeto</h2>
          <p>Descrição do serviço oferecido pela Mastershopee (§ pendente de redação jurídica).</p>
        </section>
        <section>
          <h2 className="text-base font-semibold text-foreground">2. Cadastro e conta</h2>
          <p>Condições para criação de conta, responsabilidade pelas credenciais, planos e assinatura.</p>
        </section>
        <section>
          <h2 className="text-base font-semibold text-foreground">3. Conexão com marketplaces</h2>
          <p>
            Autorização OAuth concedida pelo vendedor, escopo de dados acessados, e que a Mastershopee nunca
            solicita credenciais bancárias diretamente.
          </p>
        </section>
        <section>
          <h2 className="text-base font-semibold text-foreground">4. Pagamento e cancelamento</h2>
          <p>Cobrança recorrente, política de reembolso, cancelamento e efeitos sobre o acesso aos dados.</p>
        </section>
        <section>
          <h2 className="text-base font-semibold text-foreground">5. Limitação de responsabilidade</h2>
          <p>
            Os cálculos financeiros exibidos dependem da precisão dos dados fornecidos pelo vendedor e pelas
            APIs dos marketplaces — cláusula a ser redigida com apoio jurídico.
          </p>
        </section>
        <section>
          <h2 className="text-base font-semibold text-foreground">6. Encerramento de conta</h2>
          <p>Condições para suspensão ou encerramento pela Mastershopee ou pelo próprio cliente.</p>
        </section>
        <section>
          <h2 className="text-base font-semibold text-foreground">7. Legislação aplicável</h2>
          <p>Foro e legislação brasileira aplicável, incluindo referência à LGPD (ver Política de Privacidade).</p>
        </section>
      </div>
    </article>
  );
}
