"use client";

import { Printer } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

/** Abre a impressão do navegador — de onde também sai o PDF ("Salvar como PDF"). */
export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className={buttonVariants({ className: "gap-2" })}>
      <Printer className="h-4 w-4" /> Imprimir ou salvar PDF
    </button>
  );
}
