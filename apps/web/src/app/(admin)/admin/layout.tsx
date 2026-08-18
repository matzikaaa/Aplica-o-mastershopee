import { redirect } from "next/navigation";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  // Defense in depth (§51): middleware already blocks non-admins from /admin/*,
  // but every server entry point re-checks — never rely on a single gate.
  if (!user.isSuperAdmin) redirect("/dashboard");

  return (
    <div className="min-h-screen">
      <header className="flex h-16 items-center gap-3 border-b border-border bg-card px-6">
        <ShieldCheck className="h-5 w-5 text-primary" />
        <span className="font-semibold">Mastershopee Admin</span>
        <Link href="/dashboard" className="ml-auto text-sm text-muted-foreground hover:text-foreground">
          Voltar ao painel
        </Link>
      </header>
      <main className="mx-auto max-w-6xl p-6">{children}</main>
    </div>
  );
}
