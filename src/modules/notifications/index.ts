/**
 * Notifications module boundary (interfaces only, no implementation yet).
 * Other modules raise notifications through NotificationService so delivery (in-app, email, messaging)
 * can be added later without touching their code. Industry modules must use this, not their own queues.
 */
export type NotificationChannel = 'in_app' | 'email' | 'sms'

export interface NotificationRequest {
  businessId: string
  /** A user id, or "role:<name>" to notify everyone holding a role in the business. */
  recipient: string
  title: string
  body: string
  channel: NotificationChannel
  /** Stable key so a retried request does not notify twice. */
  idempotencyKey: string
}

export interface NotificationService {
  send(request: NotificationRequest): Promise<void>
}
