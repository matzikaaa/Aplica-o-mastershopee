import type { Metadata } from "next";
import { AlertTriangle } from "lucide-react";

export const metadata: Metadata = { title: "Termos de Uso — Mastershopee" };

/**
 * Termos de uso.
 *
 * Escritos contra o que o produto faz de verdade, incluindo as limitações —
 * a cláusula sobre a natureza dos números não é praxe defensiva, é a
 * descrição correta de um sistema que calcula lucro a partir de custos que o
 * próprio vendedor cadastra e de taxas que o marketplace confirma depois.
 * Prometer exatidão contábil seria vender o que o sistema não entrega.
 */
const ATUALIZADO_EM = "1º de setembro de 2026";

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="mt-8 space-y-3">
      <h2 className="text-lg font-semibold text-foreground">{titulo}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

export default function TermosPage() {
  return (
    <article className="pb-16">
      <h1 className="text-3xl font-semibold tracking-tight text-foreground">Termos de Uso</h1>
      <p className="mt-2 text-sm text-muted-foreground">Última atualização: {ATUALIZADO_EM}</p>

      <div className="my-6 flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <p className="text-foreground">
          <strong>Pendente de revisão jurídica.</strong> O texto descreve corretamente como o produto funciona, mas
          não foi revisado por advogado, e os campos entre colchetes precisam ser preenchidos. Não publique como
          definitivo antes disso.
        </p>
      </div>

      <Secao titulo="1. Quem somos e o que é este serviço">
        <p>
          O Mastershopee é operado por <strong>[RAZÃO SOCIAL]</strong>, CNPJ <strong>[CNPJ]</strong>. É um serviço
          por assinatura que conecta suas contas de marketplace, importa seus pedidos e calcula seu lucro líquido a
          partir dos custos que você cadastra e das taxas cobradas pelas plataformas.
        </p>
        <p>Ao criar uma conta, você concorda com estes termos.</p>
      </Secao>

      <Secao titulo="2. Sua conta">
        <p>
          Você precisa ter 18 anos ou mais e fornecer dados verdadeiros. A senha é sua responsabilidade; avise-nos
          se suspeitar de acesso indevido.
        </p>
        <p>
          Uma conta pertence a um workspace. Quem criou é o proprietário e pode convidar outras pessoas, definindo
          o que cada uma enxerga.
        </p>
      </Secao>

      <Secao titulo="3. O que os números significam — e o que não significam">
        <p>
          Esta seção é a mais importante destes termos. O Mastershopee calcula lucro a partir de três coisas: o que
          o marketplace informa, o que você cadastra e o que ainda não foi confirmado.
        </p>
        <p>
          <strong>Custos são seus.</strong> Se um produto está sem custo cadastrado, o lucro dele aparece como se a
          mercadoria fosse de graça. O sistema marca esses casos como &quot;sem custo&quot;, mas não tem como
          adivinhar o valor.
        </p>
        <p>
          <strong>Taxas nem sempre estão fechadas.</strong> Os marketplaces só confirmam a comissão e as demais
          taxas depois que o repasse é liberado. Até lá, o pedido entra marcado como taxa não confirmada, e o
          resultado dele ainda vai mudar.
        </p>
        <p>
          <strong>Não somos contabilidade.</strong> Os números servem para você decidir preço, estoque e anúncio.
          Não substituem escrituração contábil, apuração fiscal nem o extrato oficial do marketplace, e não devem
          ser usados como base única para declaração tributária.
        </p>
      </Secao>

      <Secao titulo="4. Integrações com marketplaces">
        <p>
          Ao conectar uma loja, você nos autoriza a ler seus dados de venda por meio da API oficial daquela
          plataforma. Você pode desconectar a qualquer momento, e a partir daí paramos de acessar.
        </p>
        <p>
          Dependemos dessas APIs. Se a plataforma mudar, limitar ou interromper o acesso, a sincronização pode
          falhar ou atrasar — não temos controle sobre isso e não podemos garantir disponibilidade delas.
        </p>
      </Secao>

      <Secao titulo="5. Assinatura, pagamento e cancelamento">
        <p>
          Os planos e preços estão na página de planos. A cobrança é recorrente e processada pelo Stripe; dados de
          cartão não passam pelos nossos servidores.
        </p>
        <p>
          <strong>Cancelamento a qualquer momento</strong>, pelo painel, sem precisar falar com ninguém. O acesso
          continua até o fim do período já pago e não há multa.
        </p>
        <p>
          <strong>Arrependimento:</strong> nos 7 dias após a contratação você pode desistir e receber o valor de
          volta integralmente, conforme o art. 49 do Código de Defesa do Consumidor.
        </p>
        <p>
          Se um pagamento falhar, avisamos e o acesso pode ser suspenso até a regularização. Mudanças de preço
          serão comunicadas com pelo menos 30 dias de antecedência e valem só a partir do ciclo seguinte.
        </p>
      </Secao>

      <Secao titulo="6. Uso aceitável">
        <p>
          Não use o serviço para atividade ilegal, não tente burlar limites do plano, não acesse dados de outros
          clientes, não faça engenharia reversa e não revenda o acesso sem autorização.
        </p>
        <p>
          Podemos suspender contas que violem isso. Salvo em caso de risco imediato, avisamos antes e damos chance
          de corrigir.
        </p>
      </Secao>

      <Secao titulo="7. Seus dados">
        <p>
          Os dados da sua operação são seus. Você pode exportá-los quando quiser, em Configurações → Seus dados, e
          pode apagar tudo pelo mesmo lugar.
        </p>
        <p>
          O tratamento de dados pessoais está descrito na{" "}
          <a href="/privacidade" className="underline underline-offset-2">
            Política de Privacidade
          </a>
          .
        </p>
      </Secao>

      <Secao titulo="8. Disponibilidade e limites de responsabilidade">
        <p>
          Trabalhamos para manter o serviço no ar, mas não prometemos disponibilidade ininterrupta: há manutenção,
          falhas de terceiros de quem dependemos e incidentes.
        </p>
        <p>
          Nossa responsabilidade em qualquer situação está limitada ao valor que você pagou nos 12 meses
          anteriores. Não respondemos por decisões comerciais que você tome a partir dos números — a decisão de
          preço, compra ou investimento em anúncio é sua.
        </p>
        <p>
          Nada aqui afasta os direitos que o Código de Defesa do Consumidor garante a você quando aplicável.
        </p>
      </Secao>

      <Secao titulo="9. Encerramento">
        <p>
          Você encerra quando quiser. Podemos encerrar mediante aviso de 30 dias, ou de imediato em caso de
          violação grave. Em qualquer caso, você mantém o direito de exportar seus dados antes.
        </p>
      </Secao>

      <Secao titulo="10. Mudanças nestes termos">
        <p>
          Mudanças relevantes serão avisadas por e-mail e no produto com pelo menos 30 dias de antecedência. Se não
          concordar, você pode cancelar sem custo antes de a mudança valer.
        </p>
      </Secao>

      <Secao titulo="11. Foro e contato">
        <p>
          Aplica-se a lei brasileira. Para consumidores, vale o foro do seu domicílio. Contato:{" "}
          <strong>[E-MAIL DE CONTATO]</strong>.
        </p>
      </Secao>
    </article>
  );
}
