import { isDemoMode } from '@/shared/utilities/env'
import { supabase } from '@/shared/utilities/supabase'
import { demoProductImage, demoProductThumbs, demoSetProductImage } from '@/demo/demoMart'

/** A product's pictures: a small one for lists and the till, a larger one for its details. Both are small JPEGs kept with the product. */
export interface ProductPicture { thumb: string; image: string }

const db = () => supabase!

/** Every small picture in the business, by product, for the lists and the till. */
export async function loadThumbs(businessId: string): Promise<Record<string, string>> {
  if (isDemoMode) return demoProductThumbs(businessId)
  const r = await db().from('product_thumbs').select('product_id, thumb').eq('business_id', businessId)
  if (r.error) return {}
  return Object.fromEntries((r.data ?? []).map((x) => [x.product_id as string, x.thumb as string]))
}

/** The larger picture of one product, or null when it has none. */
export async function loadProductImage(productId: string): Promise<string | null> {
  if (isDemoMode) return demoProductImage(productId)
  const r = await db().from('product_images').select('image').eq('product_id', productId).maybeSingle()
  return r.error ? null : ((r.data?.image as string | undefined) ?? null)
}

/** Sets a product's picture, or removes it when `picture` is null. Returns an error message or null. */
export async function setProductImage(businessId: string, productId: string, picture: ProductPicture | null): Promise<string | null> {
  if (isDemoMode) return demoSetProductImage(businessId, productId, picture?.thumb ?? null, picture?.image ?? null)
  const r = await db().rpc('mart_set_product_image', { p_product: productId, p_thumb: picture?.thumb ?? null, p_image: picture?.image ?? null })
  return r.error?.message ?? null
}
