import Link from "next/link";
import { Compass } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

/** Branded 404 (§44) instead of Next's default blank/generic page. */
export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="rounded-full bg-muted p-3">
        <Compass className="h-6 w-6 text-muted-foreground" />
      </div>
      <h1 className="text-lg font-semibold">Página não encontrada</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        O endereço que você acessou não existe ou foi movido.
      </p>
      <Link href="/dashboard" className={buttonVariants({})}>
        Voltar ao painel
      </Link>
    </div>
  );
}
