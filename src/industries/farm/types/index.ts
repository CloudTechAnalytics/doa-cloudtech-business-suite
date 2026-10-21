export type Production = 'poultry' | 'fish' | 'crop' | 'livestock'

export interface FarmUnit { id: string; name: string; unitType: string; productionType: Production; capacity: number | null; status: string }

/** Figures come from the ledgers (farm_batch_summaries), never from editable numbers. */
export interface FarmBatch {
  id: string; code: string; unitId: string; productionType: Production; species: string; variety: string | null
  basis: 'exact' | 'estimated'; opening: number; startDate: string; plannedEnd: string | null; status: 'active' | 'closed'
  population: number; mortality: number; entering: number; feed: number; harvest: number
}

export interface FarmEvent { id: string; batchId: string; type: string; quantity: number; reason: string | null; on: string; reversesId: string | null; reversed: boolean }
export interface FarmFeed { id: string; batchId: string; productId: string; quantity: number; on: string; notes: string | null; status: string }
export interface FarmHarvest { id: string; batchId: string; productId: string; quantity: number; date: string; animalsRemoved: number | null; status: string }
export interface FarmActivity { id: string; batchId: string | null; unitId: string | null; type: string; notes: string; on: string }

export interface FarmData { units: FarmUnit[]; batches: FarmBatch[]; events: FarmEvent[]; feeds: FarmFeed[]; harvests: FarmHarvest[]; activities: FarmActivity[] }

export type ProductArea = Production | 'general'
export type ProductSource = 'produce' | 'livestock' | 'other'
export const PRODUCT_SOURCE_LABEL: Record<ProductSource, string> = {
  produce: 'Produce (eggs, fish, harvest)',
  livestock: 'Live animals',
  other: 'Other (not stock-tracked)',
}
export const PRODUCT_AREA_LABEL: Record<ProductArea, string> = { poultry: 'Poultry', fish: 'Fish', crop: 'Crops', livestock: 'Livestock', general: 'General' }

/** What the farm sells. Available quantity is derived from stock or live batches; null when not stock-tracked. */
export interface FarmProduct {
  id: string; name: string; sku: string | null; description: string; price: number; active: boolean; unit: string
  area: ProductArea; source: ProductSource; species: string | null; available: number | null
}
export interface NewFarmProduct { name: string; sku: string; area: ProductArea; source: ProductSource; species: string; unit: string; price: number; description: string }

export interface NewBatch { unitId: string; code: string; species: string; variety: string; productionType: Production; opening: number; startDate: string; plannedEnd: string | null; basis: 'exact' | 'estimated' }

/** Mortality rate = deaths (net of corrections) ÷ animals that entered the batch (opening + transfers in). */
export const mortalityRate = (b: Pick<FarmBatch, 'mortality' | 'entering'>) => (b.entering > 0 ? (b.mortality / b.entering) * 100 : 0)

export const UNIT_TYPES: Record<Production, { value: string; label: string }[]> = {
  poultry: [{ value: 'poultry_house', label: 'Poultry house' }],
  fish: [{ value: 'pond', label: 'Pond' }, { value: 'tank', label: 'Tank' }],
  crop: [{ value: 'field', label: 'Field' }],
  livestock: [{ value: 'pen', label: 'Pen' }],
}
