import { useAsync } from '@/shared/hooks/useAsync'
import { loadInventory } from '@/modules/inventory/inventoryApi'
import { stockStatus } from '@/modules/inventory/ledger'
import { listEvents } from '@/modules/calendar/calendarApi'
import { dueReminders, expand, reminderText } from '@/modules/calendar/calendarLogic'
import type { Attention } from '@/shared/topbar/TopBar'
import { isDemoMode } from '@/shared/utilities/env'
import { supabase } from '@/shared/utilities/supabase'

const DAY = 86400000

/**
 * What needs attention in this business, from real records: the subscription (trial ending or ended, payment overdue; owners only, since they
 * are the ones who can act), stock that is out or running low (for businesses that keep stock) and calendar events whose reminder time has come. The demo has no subscriptions or
 * live stock to report, but it does show calendar reminders. Reminders appear when DOA is opened or the page is refreshed; nothing is sent by email or text.
 */
export function useWorkspaceAttention(businessId: string | null, isOwner: boolean, keepsStock: boolean, usesCalendar = false) {
  const result = useAsync(async (): Promise<Attention[]> => {
    if (!businessId) return []
    const live = !isDemoMode && !!supabase
    const items: Attention[] = []
    if (live && isOwner) {
      const { data } = await supabase!.from('subscriptions').select('status, trial_end, current_period_end').eq('business_id', businessId).order('created_at', { ascending: false }).limit(1)
      const s = data?.[0] as { status: string; trial_end: string | null; current_period_end: string } | undefined
      if (s?.status === 'trialing' && s.trial_end) {
        const days = Math.ceil((new Date(s.trial_end).getTime() - Date.now()) / DAY)
        if (days <= 7) items.push({ key: 'trial', label: days < 0 ? 'Your free trial has ended' : days === 0 ? 'Your free trial ends today' : `Your free trial ends in ${days} day${days === 1 ? '' : 's'}`, detail: 'Open Settings to see your plan', to: '/app/settings', tone: days <= 1 ? 'bad' : 'warn' })
      } else if (s?.status === 'past_due') items.push({ key: 'due', label: 'Your subscription payment is overdue', detail: 'Open Settings to see your plan', to: '/app/settings', tone: 'bad' })
      else if (s && (s.status === 'expired' || s.status === 'canceled')) items.push({ key: 'ended', label: 'Your subscription has ended', detail: 'Open Settings to see your plan', to: '/app/settings', tone: 'bad' })
    }
    if (live && keepsStock) {
      try {
        const inv = await loadInventory(businessId)
        let out = 0; let low = 0
        for (const p of inv.products.filter((x) => x.status === 'active')) {
          const st = stockStatus(inv.balances.filter((b) => b.productId === p.id).reduce((a, b) => a + b.qty, 0), p.reorderLevel)
          if (st === 'out') out++; else if (st === 'low') low++
        }
        if (out) items.push({ key: 'out', label: `${out} product${out === 1 ? ' is' : 's are'} out of stock`, to: '/app/inventory', tone: 'bad' })
        if (low) items.push({ key: 'low', label: `${low} product${low === 1 ? ' is' : 's are'} running low`, to: '/app/inventory', tone: 'warn' })
      } catch { /* stock is optional here: the bell just leaves it out */ }
    }
    if (usesCalendar) {
      try {
        const now = new Date()
        const events = await listEvents(businessId, new Date(now.getTime() - 3600000), new Date(now.getTime() + 2 * DAY))
        for (const r of dueReminders(expand(events, new Date(now.getTime() - 3600000), new Date(now.getTime() + 2 * DAY)), now)) items.push({ key: `cal-${r.key}`, label: r.title, detail: reminderText(r), to: '/app/calendar', tone: 'info' })
      } catch { /* the calendar is optional here: the bell just leaves it out */ }
    }
    return items
  }, [businessId, isOwner, keepsStock, usesCalendar])
  return { items: result.data ?? [], loading: result.loading, refresh: result.refresh }
}
