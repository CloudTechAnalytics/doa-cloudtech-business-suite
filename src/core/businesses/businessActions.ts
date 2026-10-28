import { demoArchiveBusiness, demoSetReceipt, demoSetTax, demoSetTheme } from '@/demo/demoStore'
import { isDemoMode } from '@/shared/utilities/env'
import { supabase } from '@/shared/utilities/supabase'

/** Deletes a business the owner no longer wants (archives it; records are kept). Returns an error message or null. */
export async function archiveBusiness(businessId: string, confirmName: string): Promise<string | null> {
  if (isDemoMode) return demoArchiveBusiness(businessId, confirmName)
  const { error } = await supabase!.rpc('archive_business', { p_business: businessId, p_confirm_name: confirmName })
  return error?.message ?? null
}

/** Saves the colour theme for a business. Owners and admins only; the database accepts only the named themes. Returns an error message or null. */
export async function setBusinessTheme(businessId: string, theme: string): Promise<string | null> {
  if (isDemoMode) return demoSetTheme(businessId, theme)
  const { error } = await supabase!.rpc('set_business_theme', { p_business: businessId, p_theme: theme })
  return error?.message ?? null
}

/** Saves the sales tax rate (percent) for a business. Owners and admins only; it applies to sales made from now on. Returns an error message or null. */
export async function setBusinessTax(businessId: string, rate: number): Promise<string | null> {
  if (isDemoMode) return demoSetTax(businessId, rate)
  const { error } = await supabase!.rpc('set_business_tax', { p_business: businessId, p_rate: rate })
  return error?.message ?? null
}

/** Saves what the business prints on its receipts (address, phone, closing line). Owners and admins only. Returns an error message or null. */
export async function setBusinessReceipt(businessId: string, v: { address: string; phone: string; footer: string }): Promise<string | null> {
  if (isDemoMode) return demoSetReceipt(businessId, v)
  const { error } = await supabase!.rpc('set_business_receipt', { p_business: businessId, p_address: v.address, p_phone: v.phone, p_footer: v.footer })
  return error?.message ?? null
}
