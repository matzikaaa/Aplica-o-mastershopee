import Link from "next/link";
import { ArrowRight, PlayCircle } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { DashboardMockup } from "./dashboard-mockup";

const MARKETPLACES = ["Shopee", "Mercado Livre", "SHEIN", "TikTok Shop"];

export function Hero() {
  return (
    <section className="relative overflow-hidden px-6 pb-20 pt-20 md:pt-28">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[600px] bg-[radial-gradient(60%_50%_at_50%_0%,hsl(var(--primary)/0.14),transparent)]"
      />
      <div className="mx-auto max-w-4xl text-center">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground animate-fade-in">
          <span className="h-1.5 w-1.5 rounded-full bg-success" />
          Feito para vendedores brasileiros de marketplaces
        </div>
        <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl md:text-6xl animate-slide-up">
          Descubra quanto você <span className="text-primary">realmente lucra</span> nos marketplaces
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-balance text-lg text-muted-foreground animate-slide-up">
          Conecte Shopee, Mercado Livre, SHEIN e TikTok Shop e acompanhe faturamento, taxas, anúncios e
          lucro líquido automaticamente — sem planilhas.
        </p>
        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row animate-slide-up">
          <Link href="/register" className={buttonVariants({ size: "lg", className: "gap-2" })}>
            Começar agora <ArrowRight className="h-4 w-4" />
          </Link>
          <a href="#demonstracao" className={buttonVariants({ size: "lg", variant: "outline", className: "gap-2" })}>
            <PlayCircle className="h-4 w-4" /> Ver demonstração
          </a>
        </div>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-muted-foreground animate-fade-in">
          {MARKETPLACES.map((m) => (
            <span key={m} className="font-medium">
              {m}
            </span>
          ))}
        </div>
      </div>

      <div id="demonstracao" className="mx-auto mt-16 max-w-6xl animate-slide-up">
        <DashboardMockup />
      </div>
    </section>
  );
}
