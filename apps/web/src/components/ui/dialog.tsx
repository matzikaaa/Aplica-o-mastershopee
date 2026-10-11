"use client";

import { X } from "lucide-react";
import { useEffect, useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Esc fecha, como em qualquer janela. Sem `role="dialog"` o leitor de tela
 * nem anunciava que uma janela abriu — o foco continuava "na página" atrás.
 */
function useFecharComEsc(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  const tituloId = useId();
  useFecharComEsc(open, onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-foreground/40 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        className={cn(
          "relative w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl animate-slide-up",
          className,
        )}
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 id={tituloId} className="text-lg font-semibold">
              {title}
            </h2>
            {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
          </div>
          <button onClick={onClose} aria-label="Fechar" className="rounded-md p-1 text-muted-foreground hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Slide-in panel for detail views (order breakdown, "Como calculamos?" — §21, §83). */
export function Drawer({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const tituloId = useId();
  useFecharComEsc(open, onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] flex justify-end">
      <div className="absolute inset-0 bg-foreground/40 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        className="relative h-full w-full max-w-md overflow-y-auto border-l border-border bg-card p-6 shadow-2xl animate-slide-up"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id={tituloId} className="text-lg font-semibold">
            {title}
          </h2>
          <button onClick={onClose} aria-label="Fechar" className="rounded-md p-1 text-muted-foreground hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirmar",
  // "Cancelar" ao lado de "Cancelar assinatura" deixava ambíguo qual botão
  // mantinha a assinatura. Quem desiste não está cancelando nada: volta.
  cancelLabel = "Voltar",
  destructive,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title} description={description}>
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted">
          {cancelLabel}
        </button>
        <button
          onClick={() => {
            onConfirm();
            onClose();
          }}
          className={cn(
            "rounded-lg px-4 py-2 text-sm font-medium text-primary-foreground",
            destructive ? "bg-destructive" : "bg-primary",
          )}
        >
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}
