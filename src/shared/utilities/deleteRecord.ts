import { demoDeleteRecord } from '@/demo/demoDelete'
import type { DeleteKind } from '@/demo/demoDelete'
import { isDemoMode } from '@/shared/utilities/env'
import { supabase } from '@/shared/utilities/supabase'

export type { DeleteKind }

/** Deletes a record that was never used (null on success, otherwise the reason it was refused). Records with history are refused: archive them instead. */
export async function deleteRecord(businessId: string, kind: DeleteKind, id: string): Promise<string | null> {
  if (isDemoMode) return demoDeleteRecord(businessId, kind, id)
  const { error } = await supabase!.rpc('delete_record', { p_kind: kind, p_id: id })
  return error?.message ?? null
}
