/**
 * Quem opera a plataforma: a coluna `isSuperAdmin` ou um e-mail em
 * ADMIN_EMAILS.
 *
 * A coluna não tem tela nem script para ser ligada, e as ferramentas de
 * diagnóstico da Shopee passaram a aparecer só para administradores — sem um
 * jeito de configurar isso na Vercel, o próprio dono perderia o diagnóstico
 * que usa para acompanhar a integração.
 */
export function emailsDeAdmin(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(/[,;\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function ehAdminDaPlataforma(user: { isSuperAdmin: boolean; email: string }): boolean {
  return user.isSuperAdmin || emailsDeAdmin().includes(user.email.toLowerCase());
}
