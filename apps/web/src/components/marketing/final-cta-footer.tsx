import Link from "next/link";
import { ArrowRight, TrendingUp } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

export function FinalCta() {
  return (
    <section className="px-6 py-24">
      <div className="mx-auto max-w-4xl rounded-2xl bg-primary px-8 py-16 text-center text-primary-foreground">
        <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
          Pare de adivinhar seu lucro. Comece a saber.
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-balance text-primary-foreground/80">
          Conecte suas contas em minutos e veja seu lucro líquido real hoje mesmo.
        </p>
        <Link
          href="/register"
          className={buttonVariants({
            size: "lg",
            className: "mt-8 gap-2 bg-primary-foreground text-primary hover:opacity-90",
          })}
        >
          Começar agora <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </section>
  );
}

const FOOTER_LINKS = {
  Produto: [
    { label: "Recursos", href: "#recursos" },
    { label: "Planos", href: "#planos" },
    { label: "FAQ", href: "#faq" },
  ],
  Empresa: [
    { label: "Sobre", href: "/sobre" },
    { label: "Central de ajuda", href: "/ajuda" },
    { label: "Contato", href: "/contato" },
  ],
  Legal: [
    { label: "Termos de uso", href: "/termos" },
    { label: "Política de privacidade", href: "/privacidade" },
  ],
};

export function Footer() {
  return (
    <footer className="border-t border-border px-6 py-14">
      <div className="mx-auto grid max-w-6xl gap-10 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
        <div>
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <TrendingUp className="h-4.5 w-4.5" />
            </span>
            Mastershopee
          </Link>
          <p className="mt-3 max-w-xs text-sm text-muted-foreground">
            Central financeira inteligente para vendedores de marketplaces.
          </p>
        </div>
        {Object.entries(FOOTER_LINKS).map(([title, links]) => (
          <div key={title}>
            <h4 className="mb-3 text-sm font-semibold">{title}</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              {links.map((l) => (
                <li key={l.label}>
                  <Link href={l.href} className="hover:text-foreground">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mx-auto mt-10 max-w-6xl border-t border-border pt-6 text-xs text-muted-foreground">
        © {new Date().getFullYear()} Mastershopee. Todos os direitos reservados.
      </div>
    </footer>
  );
}
