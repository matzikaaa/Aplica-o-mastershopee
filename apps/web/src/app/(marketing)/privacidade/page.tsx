import type { Metadata } from "next";
import { AlertTriangle } from "lucide-react";

export const metadata: Metadata = { title: "Política de Privacidade — Mastershopee" };

/**
 * §79: skeleton only, not finished legal copy — same caveat as /termos.
 * Sections reflect what LGPD (Lei 13.709/2018) requires a privacy policy
 * to address for a product handling seller financial and marketplace data.
 */
export default function PrivacidadePage() {
  return (
    <article>
      <h1 className="text-3xl font-semibold tracking-tight text-foreground">Política de Privacidade</h1>

      <div className="my-6 flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <p className="text-foreground">
          <strong>Este documento está em elaboração.</strong> A estrutura abaixo reflete o que a LGPD exige
          de uma política de privacidade, mas o conteúdo ainda não foi revisado por um profissional
          jurídico e não deve ser considerado a política definitiva da Mastershopee.
        </p>
      </div>

      <div className="space-y-6 text-sm text-muted-foreground">
        <section>
          <h2 className="text-base font-semibold text-foreground">1. Dados coletados</h2>
          <p>
            Dados de cadastro (nome, e-mail), dados de vendas sincronizados dos marketplaces conectados
            (via OAuth, nunca senha bancária), e dados de uso da plataforma.
          </p>
        </section>
        <section>
          <h2 className="text-base font-semibold text-foreground">2. Finalidade do tratamento</h2>
          <p>Cálculo de métricas financeiras, geração de relatórios, envio de alertas e resumos.</p>
        </section>
        <section>
          <h2 className="text-base font-semibold text-foreground">3. Compartilhamento com terceiros</h2>
          <p>
            Provedores essenciais à operação (hospedagem, processamento de pagamento, envio de WhatsApp) —
            lista detalhada a ser publicada.
          </p>
        </section>
        <section>
          <h2 className="text-base font-semibold text-foreground">4. Segurança</h2>
          <p>
            Credenciais de marketplace armazenadas com criptografia AES-256-GCM; senhas nunca armazenadas
            em texto plano (scrypt com salt); isolamento de dados por empresa (multi-tenant).
          </p>
        </section>
        <section>
          <h2 className="text-base font-semibold text-foreground">5. Direitos do titular (LGPD)</h2>
          <p>
            Acesso, correção, portabilidade e eliminação dos dados. O fluxo de autoatendimento para
            exportação/exclusão de conta ainda não está implementado nesta versão — solicitações devem ser
            feitas por e-mail até que esse recurso exista.
          </p>
        </section>
        <section>
          <h2 className="text-base font-semibold text-foreground">6. Retenção</h2>
          <p>Prazo de retenção de dados após cancelamento da conta — a definir.</p>
        </section>
      </div>
    </article>
  );
}
