import { supabase } from '@/shared/utilities/supabase'

export interface AuditEntry { id: string; action: string; entityType: string; at: string; actor: string | null; metadata: Record<string, unknown> }

/** Most recent audit records for a business. Row-level security limits this to users holding audit.read. */
export async function listAudit(businessId: string, limit = 50): Promise<AuditEntry[]> {
  if (!supabase) return []
  const r = await supabase.from('audit_logs').select('id, action, entity_type, occurred_at, actor_user_id, metadata')
    .eq('business_id', businessId).order('occurred_at', { ascending: false }).limit(limit)
  if (r.error) throw new Error(r.error.message)
  return (r.data ?? []).map((x) => ({ id: x.id, action: x.action, entityType: x.entity_type, at: x.occurred_at, actor: x.actor_user_id, metadata: (x.metadata ?? {}) as Record<string, unknown> }))
}
