"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Circle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ChecklistStep {
  key: string;
  label: string;
  href: string;
  done: boolean;
}

/** §4 — visual onboarding progress indicator. */
export function OnboardingChecklist({ steps }: { steps: ChecklistStep[] }) {
  const router = useRouter();
  const allDone = steps.every((s) => s.done);

  async function finish() {
    await fetch("/api/onboarding/complete", { method: "POST" });
    router.push("/dashboard");
  }

  return (
    <div className="space-y-3">
      {steps.map((step) => (
        <Link
          key={step.key}
          href={step.href}
          className={cn(
            "flex items-center gap-3 rounded-xl border p-4 transition-colors hover:bg-muted",
            step.done ? "border-success/30 bg-success/5" : "border-border",
          )}
        >
          {step.done ? <CheckCircle2 className="h-5 w-5 text-success" /> : <Circle className="h-5 w-5 text-muted-foreground" />}
          <span className={cn("text-sm font-medium", step.done && "text-success")}>{step.label}</span>
        </Link>
      ))}

      <Button className="mt-4 w-full" onClick={finish}>
        {allDone ? "Ir para o Dashboard" : "Pular por agora e ir para o Dashboard"}
      </Button>
    </div>
  );
}
