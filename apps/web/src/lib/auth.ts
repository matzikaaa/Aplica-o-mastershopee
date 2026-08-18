import type { AuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "@mastershopee/database";
import { verifyPassword } from "./password";
import { isAllowed } from "./rate-limit";

/**
 * NextAuth v4 configuration. CredentialsProvider forces JWT sessions (a
 * v4 constraint — the Prisma adapter's database-session strategy is
 * incompatible with a Credentials provider), so `session.user.id` is
 * populated via the `jwt`/`session` callbacks below instead of an
 * adapter-managed Session row. Workspace membership is always
 * re-resolved server-side per request (see `getCurrentWorkspace`) —
 * never trust a workspace id embedded in the client.
 */
export const authOptions: AuthOptions = {
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "E-mail", type: "email" },
        password: { label: "Senha", type: "password" },
      },
      async authorize(credentials, req) {
        if (!credentials?.email || !credentials.password) return null;

        // Brute-force protection (§38): throttle by IP and by target email
        // independently, so an attacker can't dodge the limit by rotating
        // either one alone.
        const ip = req.headers?.["x-forwarded-for"]?.toString().split(",")[0]?.trim() ?? "unknown";
        const email = credentials.email.toLowerCase();
        const [ipAllowed, emailAllowed] = await Promise.all([
          isAllowed(`login:ip:${ip}`, 20, 300),
          isAllowed(`login:email:${email}`, 8, 300),
        ]);
        if (!ipAllowed || !emailAllowed) {
          throw new Error("TOO_MANY_ATTEMPTS");
        }

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return null;
        if (!verifyPassword(credentials.password, user.passwordHash)) return null;
        if (!user.emailVerifiedAt) {
          throw new Error("EMAIL_NOT_VERIFIED");
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.avatarUrl ?? undefined,
          isSuperAdmin: user.isSuperAdmin,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.isSuperAdmin = (user as { isSuperAdmin?: boolean }).isSuperAdmin ?? false;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        (session.user as { id?: string; isSuperAdmin?: boolean }).id = token.sub;
        (session.user as { isSuperAdmin?: boolean }).isSuperAdmin = Boolean(token.isSuperAdmin);
      }
      return session;
    },
  },
};
