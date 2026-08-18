import type { Metadata } from "next";

export const metadata: Metadata = { title: "Sobre — Mastershopee" };

export default function SobrePage() {
  return (
    <article className="space-y-4">
      <h1 className="text-3xl font-semibold tracking-tight">Sobre a Mastershopee</h1>
      <p className="text-muted-foreground">
        A Mastershopee nasceu de um problema simples de resolver e difícil de enxergar: vendedores de
        marketplace sabem quanto faturam, mas raramente sabem quanto realmente sobra depois de comissões,
        taxas, anúncios, impostos e devoluções.
      </p>
      <p className="text-muted-foreground">
        Conectamos suas contas de Shopee, Mercado Livre, SHEIN e TikTok Shop através das APIs oficiais de
        cada plataforma e calculamos o lucro líquido real — por pedido, por produto e por marketplace —
        sempre mostrando a conta por trás de cada número.
      </p>
    </article>
  );
}
