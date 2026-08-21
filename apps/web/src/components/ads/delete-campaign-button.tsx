"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Removes a manually entered campaign and its whole period of spend.
 *
 * Confirms inline rather than through a browser dialog, and names the amount
 * about to leave the profit calculation — "apagar" on a money row deserves to
 * show what it costs before it happens.
 */
export function DeleteCampaignButton({
  campaignId,
  name,
  total,
}: {
  campaignId: string;
  name: string;
  total: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function remove() {
    setLoading(true);
    const res = await fetch("/api/ads/campaign", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ campaignId }),
    });
    setLoading(false);
    if (res.ok) router.refresh();
    else setConfirming(false);
  }

  if (!confirming) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setConfirming(true)}
        aria-label={`Apagar ${name}`}
        className="text-muted-foreground hover:text-destructive"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    );
  }

  return (
    <span className="flex items-center justify-end gap-2 whitespace-nowrap">
      <span className="text-xs text-muted-foreground">Apagar {total}?</span>
      <Button variant="destructive" size="sm" onClick={remove} disabled={loading}>
        {loading ? "..." : "Sim"}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
        Não
      </Button>
    </span>
  );
}
