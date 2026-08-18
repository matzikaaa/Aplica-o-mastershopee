import { Navbar } from "@/components/marketing/navbar";
import { Footer } from "@/components/marketing/final-cta-footer";

/** Shared chrome for public informational pages (ajuda, termos, privacidade, sobre, contato). */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="mx-auto max-w-3xl px-6 py-16">{children}</main>
      <Footer />
    </div>
  );
}
