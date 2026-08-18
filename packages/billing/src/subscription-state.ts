export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "expired"
  | "incomplete";

/**
 * Backend-enforced access rules for the subscription state machine (§31).
 * The frontend never independently decides whether premium features are
 * unlocked — every gated route/action re-checks this against the
 * workspace's current Subscription row.
 */
export const FULL_ACCESS_STATUSES: SubscriptionStatus[] = ["trialing", "active"];
/** Grace period: user keeps read access so they don't lose visibility while fixing payment, but cannot create new resources. */
export const GRACE_ACCESS_STATUSES: SubscriptionStatus[] = ["past_due"];
export const BLOCKED_STATUSES: SubscriptionStatus[] = ["canceled", "expired", "incomplete"];

export function hasDashboardAccess(status: SubscriptionStatus): boolean {
  return FULL_ACCESS_STATUSES.includes(status) || GRACE_ACCESS_STATUSES.includes(status);
}

export function hasFullAccess(status: SubscriptionStatus): boolean {
  return FULL_ACCESS_STATUSES.includes(status);
}

export function isInGracePeriod(status: SubscriptionStatus): boolean {
  return GRACE_ACCESS_STATUSES.includes(status);
}
