import type { DemoDashboard } from '@/shared/components/widgets'

/** Illustrative figures for demo mode only. */
export const retailDemo: DemoDashboard = {
  kpis: [
    { label: 'Sales today', value: '₦482,500', note: '37 transactions' },
    { label: 'Purchases (this month)', value: '₦3,120,000', note: '12 supplier deliveries' },
    { label: 'Low-stock items', value: '7', note: 'At or below reorder level' },
    { label: 'Expenses (this month)', value: '₦640,200', note: 'Rent, power, wages' },
  ],
  activity: [
    { when: '10:42', text: 'Sale #1048 · ₦12,300 · cash' },
    { when: '10:15', text: 'Goods received from Alpha Distributors (24 lines)' },
    { when: '09:30', text: 'Low-stock alert: Indomie Noodles 70g carton' },
  ],
}
