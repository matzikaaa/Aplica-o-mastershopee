import { NextResponse } from "next/server";
import { ShopeeProvider } from "@mastershopee/integrations";
import { requireWorkspace } from "@/lib/session";
import { getIntegrationEnv } from "@/lib/integration-env";

/**
 * Asks Shopee whether our partner credentials and signature are acceptable,
 * without dragging a seller through an OAuth redirect to find out.
 *
 * `error_sign` surfacing mid-redirect is indistinguishable from half a dozen
 * unrelated problems, and each round of guessing costs a full authorization
 * attempt. Here the whole request is ours, so the answer arrives in one call
 * with Shopee's own error attached.
 *
 * Também sonda as leituras possíveis do partner_key (a Shopee imprime a chave
 * como `shpk` + hexadecimal e não documenta se a string exibida *é* a chave)
 * e reporta qual delas a própria Shopee aceitou.
 *
 * Deliberately reports lengths, never the credentials themselves — the point
 * is to spot a truncated paste, not to echo a secret into a browser tab.
 */
export async function POST() {
  await requireWorkspace();

  const env = getIntegrationEnv();
  const provider = new ShopeeProvider(
    env.SHOPEE_PARTNER_ID ?? "",
    env.SHOPEE_PARTNER_KEY ?? "",
    env.SHOPEE_REDIRECT_URL ?? "",
    env.SHOPEE_ENV ?? "live",
    env.SHOPEE_KEY_ENCODING ?? "raw",
  );

  const diagnosis = await provider.diagnose();
  return NextResponse.json(diagnosis, { status: diagnosis.ok ? 200 : 400 });
}
