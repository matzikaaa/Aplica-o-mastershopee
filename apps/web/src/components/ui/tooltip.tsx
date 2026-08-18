"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Lightweight tooltip used to explain jargon (ROAS, ACOS, margem, ticket
 * médio — §45) without a heavy positioning library.
 */
export function Tooltip({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span
      className={cn("relative inline-flex", className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open && (
        <span
          role="tooltip"
          className="absolute bottom-full left-1/2 z-50 mb-2 w-max max-w-xs -translate-x-1/2 rounded-md bg-foreground px-2.5 py-1.5 text-xs text-background shadow-lg animate-fade-in"
        >
          {label}
        </span>
      )}
    </span>
  );
}
