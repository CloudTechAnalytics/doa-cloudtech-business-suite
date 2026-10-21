import type { DemoDashboard } from '@/shared/components/widgets'

/** Illustrative figures for demo mode only. */
export const bakeryDemo: DemoDashboard = {
  kpis: [
    { label: 'Loaves produced today', value: '1,240', note: '4 production batches' },
    { label: 'Wastage (7 days)', value: '2.8%', note: 'Wasted ÷ produced' },
    { label: 'Flour on hand', value: '420 kg', note: 'Reorder at 200 kg' },
    { label: 'Sales today', value: '₦356,800', note: '58 orders' },
  ],
  activity: [
    { when: '06:00', text: 'Production batch PB-212 started · Sliced bread' },
    { when: '05:20', text: 'Ingredients consumed · 50 kg flour, 1 kg yeast' },
    { when: 'Yesterday', text: 'Recipe "Sliced bread" updated to v3' },
  ],
}
