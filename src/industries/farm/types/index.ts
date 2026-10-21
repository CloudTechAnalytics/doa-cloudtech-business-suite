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

export interface NewBatch { unitId: string; code: string; species: string; variety: string; productionType: Production; opening: number; startDate: string; plannedEnd: string | null; basis: 'exact' | 'estimated' }

/** Mortality rate = deaths (net of corrections) ÷ animals that entered the batch (opening + transfers in). */
export const mortalityRate = (b: Pick<FarmBatch, 'mortality' | 'entering'>) => (b.entering > 0 ? (b.mortality / b.entering) * 100 : 0)

export const UNIT_TYPES: Record<Production, { value: string; label: string }[]> = {
  poultry: [{ value: 'poultry_house', label: 'Poultry house' }],
  fish: [{ value: 'pond', label: 'Pond' }, { value: 'tank', label: 'Tank' }],
  crop: [{ value: 'field', label: 'Field' }],
  livestock: [{ value: 'pen', label: 'Pen' }],
}
