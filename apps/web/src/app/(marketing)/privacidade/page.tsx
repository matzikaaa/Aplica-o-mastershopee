import type { Metadata } from "next";
import { AlertTriangle } from "lucide-react";

export const metadata: Metadata = { title: "Política de Privacidade — Mastershopee" };

/**
 * Política de privacidade sob a LGPD (Lei 13.709/2018).
 *
 * O conteúdo descreve o que a aplicação realmente faz — cada afirmação aqui
 * corresponde a um comportamento do código, não a um texto genérico copiado
 * de outro produto. Uma política que promete o que o sistema não faz é pior
 * que nenhuma: vira prova documental contra quem a publicou.
 *
 * O aviso de revisão jurídica continua no topo de propósito. Descrever o
 * tratamento com precisão técnica é uma coisa; garantir que as bases legais
 * invocadas se sustentam diante da ANPD é outra, e essa segunda exige
 * advogado. Os campos entre colchetes só o operador pode preencher.
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

export default function PrivacidadePage() {
  return (
    <article className="pb-16">
      <h1 className="text-3xl font-semibold tracking-tight text-foreground">Política de Privacidade</h1>
      <p className="mt-2 text-sm text-muted-foreground">Última atualização: {ATUALIZADO_EM}</p>

      <div className="my-6 flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <p className="text-foreground">
          <strong>Pendente de revisão jurídica.</strong> O texto abaixo descreve com precisão o que o sistema faz
          com os dados, mas não foi revisado por advogado, e os campos entre colchetes ainda precisam ser
          preenchidos com os dados da empresa. Não publique como definitivo antes disso.
        </p>
      </div>

      <Secao titulo="1. Quem é o controlador">
        <p>
          O Mastershopee é operado por <strong>[RAZÃO SOCIAL]</strong>, CNPJ <strong>[CNPJ]</strong>, com sede em{" "}
          <strong>[ENDEREÇO]</strong>. Para qualquer assunto relativo a dados pessoais, incluindo o exercício dos
          direitos descritos abaixo, o contato é <strong>[E-MAIL DO ENCARREGADO]</strong>.
        </p>
        <p>
          Em relação aos dados dos seus compradores que transitam pelos marketplaces, você é o controlador e o
          Mastershopee atua como operador: tratamos esses dados apenas para executar o serviço que você contratou.
        </p>
      </Secao>

      <Secao titulo="2. Que dados coletamos">
        <p>
          <strong>Da sua conta:</strong> nome, e-mail e senha (guardada apenas como hash, nunca em texto legível).
        </p>
        <p>
          <strong>Da sua operação:</strong> produtos, SKUs, custos que você cadastra, pedidos, valores, taxas
          cobradas pelos marketplaces, gastos com anúncios e as métricas calculadas a partir disso.
        </p>
        <p>
          <strong>Das integrações:</strong> tokens de acesso aos marketplaces que você conecta, guardados
          cifrados com AES-256-GCM, e os identificadores das suas lojas.
        </p>
        <p>
          <strong>Sobre compradores:</strong> praticamente nada, e isso é uma decisão de projeto. As APIs dos
          marketplaces devolvem nome, telefone, documento e endereço de entrega junto com cada pedido. Esses
          campos são removidos antes de qualquer gravação, porque nenhum cálculo desta aplicação os usa — e dado
          pessoal sem finalidade não tem base legal para ser tratado. O que fica de cada pedido são valores,
          quantidades, SKUs e datas.
        </p>
        <p>
          <strong>Se você ativar o WhatsApp:</strong> o número que você informar, e o registro de quais relatórios
          foram enviados.
        </p>
      </Secao>

      <Secao titulo="3. Para que usamos e com que base legal">
        <p>
          <strong>Execução do contrato</strong> (art. 7º, V) para tudo que é o serviço em si: calcular seu lucro,
          sincronizar pedidos, enviar os relatórios que você configurou, cobrar a assinatura.
        </p>
        <p>
          <strong>Cumprimento de obrigação legal</strong> (art. 7º, II) para registros fiscais e contábeis da
          assinatura.
        </p>
        <p>
          <strong>Legítimo interesse</strong> (art. 7º, IX) para segurança: registros de acesso, limitação de
          tentativas de login e trilha de auditoria das ações feitas na conta.
        </p>
        <p>Não vendemos dados, não fazemos perfilamento publicitário e não usamos seus dados para treinar modelos.</p>
      </Secao>

      <Secao titulo="4. Com quem compartilhamos">
        <p>Só com quem é necessário para o serviço funcionar, e cada um com uma função específica:</p>
        <ul className="ml-5 list-disc space-y-1">
          <li>
            <strong>Vercel</strong> — hospedagem da aplicação.
          </li>
          <li>
            <strong>Neon</strong> — banco de dados, hospedado em São Paulo (AWS sa-east-1).
          </li>
          <li>
            <strong>Marketplaces que você conectar</strong> (Shopee, e outros conforme você habilitar) — recebem
            apenas as chamadas necessárias para ler seus próprios dados de venda.
          </li>
          <li>
            <strong>Meta (WhatsApp Business Platform)</strong> — apenas se você ativar os relatórios por WhatsApp.
          </li>
          <li>
            <strong>Stripe</strong> — processamento de pagamento. Dados de cartão vão direto para o Stripe e nunca
            passam pelos nossos servidores.
          </li>
          <li>
            <strong>Sentry</strong> — monitoramento de erros, se habilitado, sem dados pessoais anexados.
          </li>
        </ul>
        <p>
          Alguns desses serviços processam dados fora do Brasil. A transferência internacional se apoia no art. 33,
          e cabe a <strong>[RAZÃO SOCIAL]</strong> manter as garantias contratuais correspondentes.
        </p>
      </Secao>

      <Secao titulo="5. Por quanto tempo guardamos">
        <p>
          Enquanto sua conta existir. Se você excluir a conta, os dados são apagados de imediato e por completo —
          não marcamos como inativo nem mantemos cópia de cortesia.
        </p>
        <p>
          A exceção é o que a lei obriga a guardar: registros de acesso por 6 meses (Marco Civil da Internet, art.
          15) e documentos fiscais da assinatura pelo prazo da legislação tributária.
        </p>
      </Secao>

      <Secao titulo="6. Seus direitos">
        <p>
          A LGPD (art. 18) garante que você possa confirmar o tratamento, acessar, corrigir, portar, revogar
          consentimento e pedir eliminação. Dois deles estão disponíveis direto no produto, sem depender de
          pedido: em <strong>Configurações → Seus dados</strong> você exporta tudo em um arquivo e exclui a conta
          com todos os dados.
        </p>
        <p>
          Para os demais, escreva para <strong>[E-MAIL DO ENCARREGADO]</strong>. O prazo de resposta é de 15 dias.
        </p>
      </Secao>

      <Secao titulo="7. Segurança">
        <p>
          Senhas guardadas como hash. Tokens de marketplace cifrados com AES-256-GCM, com a chave fora do banco.
          Tráfego sempre por HTTPS. Isolamento por workspace em todas as consultas, para que dados de um cliente
          não alcancem outro. Limitação de tentativas de login. Trilha de auditoria das ações sensíveis.
        </p>
        <p>
          Nenhuma medida elimina risco por completo. Em caso de incidente que possa causar risco relevante,
          comunicaremos você e a ANPD, conforme o art. 48.
        </p>
      </Secao>

      <Secao titulo="8. Cookies">
        <p>
          Usamos apenas cookies necessários: o que mantém sua sessão aberta e o que protege o fluxo de autorização
          dos marketplaces contra fraude. Não há cookies de publicidade nem de rastreamento entre sites.
        </p>
      </Secao>

      <Secao titulo="9. Mudanças">
        <p>
          Se esta política mudar de forma relevante, avisaremos por e-mail e dentro do produto antes de a mudança
          valer. A data no topo indica a versão vigente.
        </p>
      </Secao>
    </article>
  );
}
