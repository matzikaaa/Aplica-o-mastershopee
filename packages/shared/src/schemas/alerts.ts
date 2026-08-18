import { z } from "zod";

export const alertRuleTypeSchema = z.enum([
  "NEGATIVE_MARGIN_PRODUCT",
  "AD_SPEND_THRESHOLD",
  "NET_MARGIN_BELOW",
  "MARKETPLACE_SYNC_FAILED",
  "DAILY_REVENUE_ABOVE",
]);

export const alertRuleSchema = z.object({
  type: alertRuleTypeSchema,
  severity: z.enum(["CRITICAL", "IMPORTANT", "INFORMATIVE"]).default("IMPORTANT"),
  config: z.record(z.union([z.number(), z.string(), z.boolean()])),
  channels: z.array(z.enum(["whatsapp", "in_app", "email"])).min(1),
  isActive: z.boolean().default(true),
});
export type AlertRuleInput = z.infer<typeof alertRuleSchema>;
