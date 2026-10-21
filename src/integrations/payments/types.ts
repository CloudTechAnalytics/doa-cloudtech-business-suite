/**
 * Payment-provider boundary (interfaces only). No provider is selected or integrated yet.
 * Subscription changes must come from verified, idempotent provider events (see subscription_events in the
 * database); the browser's claim that a payment succeeded is never trusted.
 */
export interface VerifiedProviderEvent {
  /** Provider's own event id; stored uniquely so a replayed webhook is ignored. */
  providerEventReference: string
  businessId: string
  type: 'payment_succeeded' | 'payment_failed' | 'subscription_canceled' | 'subscription_renewed'
  occurredAt: string
}

export interface PaymentProvider {
  /** Verifies the signature and returns the event, or throws if it is not authentic. */
  verifyWebhook(headers: Record<string, string>, rawBody: string): Promise<VerifiedProviderEvent>
}
