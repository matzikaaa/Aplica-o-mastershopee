"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";
import { ChevronDown, LogOut, Settings, User as UserIcon } from "lucide-react";
import { NotificationBell } from "./notification-bell";
import { cn } from "@/lib/utils";

export function Header({
  workspaceName,
  userName,
  userEmail,
  syncStatus,
}: {
  workspaceName: string;
  userName: string;
  userEmail: string;
  syncStatus?: "synced" | "syncing" | "error" | "manual" | "none";
}) {
  const [profileOpen, setProfileOpen] = useState(false);

  // "none" and "manual" are their own states on purpose: with nothing
  // connected there is nothing to have synced, and showing "Sincronizado"
  // over hand-loaded spreadsheet data would assert a status that doesn't
  // exist (§61, §96).
  const statusConfig = {
    none: { label: "Nenhum marketplace conectado", dot: "bg-muted-foreground/50" },
    manual: { label: "Dados importados por planilha", dot: "bg-muted-foreground/50" },
    synced: { label: "Sincronizado", dot: "bg-success" },
    syncing: { label: "Sincronizando...", dot: "bg-warning animate-pulse" },
    error: { label: "Erro de sincronização", dot: "bg-destructive" },
  } as const;
  const status = statusConfig[syncStatus ?? "none"];

  return (
    <header className="flex h-16 items-center justify-between border-b border-border bg-card px-6">
      <div className="flex items-center gap-3">
        <button className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium">
          {workspaceName}
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
        <div className="hidden items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground sm:flex">
          <span className={cn("h-1.5 w-1.5 rounded-full", status.dot)} />
          {status.label}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <NotificationBell />

        <div className="relative">
          <button
            onClick={() => setProfileOpen((v) => !v)}
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-sm font-medium text-primary">
              {userName.charAt(0).toUpperCase()}
            </span>
            <ChevronDown className="hidden h-3.5 w-3.5 text-muted-foreground sm:block" />
          </button>
          {profileOpen && (
            <div className="absolute right-0 z-20 mt-2 w-56 rounded-lg border border-border bg-card p-1 shadow-lg animate-fade-in">
              <div className="px-3 py-2">
                <p className="text-sm font-medium">{userName}</p>
                <p className="text-xs text-muted-foreground">{userEmail}</p>
              </div>
              <div className="my-1 border-t border-border" />
              <a href="/settings" className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted">
                <UserIcon className="h-4 w-4" /> Perfil
              </a>
              <a href="/settings" className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted">
                <Settings className="h-4 w-4" /> Configurações
              </a>
              <button
                onClick={() => signOut({ callbackUrl: "/" })}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-destructive hover:bg-destructive/10"
              >
                <LogOut className="h-4 w-4" /> Sair
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
