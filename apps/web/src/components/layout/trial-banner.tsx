import Link from "next/link";

/**
 * Quantos dias faltam do teste grátis.
 *
 * Sem isto o teste acabava de surpresa: num dia o painel abre, no seguinte
 * redireciona para a cobrança. Cliente surpreendido no momento de pagar
 * cancela; cliente avisado com antecedência escolhe um plano. A contagem fica
 * discreta enquanto há folga e ganha peso nos últimos três dias, que é quando
 * a decisão de fato acontece.
 */
export function TrialBanner({ dias }: { dias: number }) {
  const urgente = dias <= 3;
  const texto =
    dias === 0
      ? "Seu teste grátis termina hoje."
      : dias === 1
        ? "Falta 1 dia do seu teste grátis."
        : `Faltam ${dias} dias do seu teste grátis.`;

  return (
    <div
      className={
        urgente
          ? "flex items-center justify-between gap-3 border-b border-warning/30 bg-warning/10 px-6 py-2 text-sm"
          : "flex items-center justify-between gap-3 border-b border-border bg-muted/40 px-6 py-1.5 text-xs text-muted-foreground"
      }
    >
      <span>
        {texto}
        {urgente && " Escolha um plano para não perder o acesso aos seus números."}
      </span>
      <Link href="/subscription" className="shrink-0 font-medium text-primary hover:underline">
        Ver planos
      </Link>
    </div>
  );
}
