import { Navbar } from "@/components/marketing/navbar";
import { Hero } from "@/components/marketing/hero";
import {
  ProblemSolution,
  Benefits,
  ProfitExplain,
  LossProductsShowcase,
  WhatsAppAndCosts,
  ComparisonAndAnalytics,
  FeaturesGrid,
} from "@/components/marketing/sections";
import { Pricing } from "@/components/marketing/pricing";
import { Faq } from "@/components/marketing/faq";
import { FinalCta, Footer } from "@/components/marketing/final-cta-footer";

export default function LandingPage() {
  return (
    <div className="min-h-screen">
      <Navbar />
      <main>
        <Hero />
        <ProblemSolution />
        <Benefits />
        <ProfitExplain />
        <LossProductsShowcase />
        <WhatsAppAndCosts />
        <ComparisonAndAnalytics />
        <FeaturesGrid />
        <Pricing />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}
