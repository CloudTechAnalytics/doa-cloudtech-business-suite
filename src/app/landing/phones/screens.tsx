import { Check, ChevronRight, Droplets, Egg, Pill, Search, TriangleAlert, Wheat } from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * The app screens shown inside the phone mockups on the landing page. They are drawn with the same colours and shapes as the real app, not screenshots, so they stay
 * sharp at any size and can change with the theme. Everything on them is sample data.
 */
const shell = 'absolute inset-0 flex flex-col bg-[#f6fbfd] pt-9 text-[10px] leading-tight text-ink'
const Head = ({ title, sub, color = 'bg-brand' }: { title: string; sub?: string; color?: string }) => (
  <div className={`${color} px-3.5 pb-3 pt-2 text-white`}><p className="text-[13px] font-extrabold">{title}</p>{sub && <p className="mt-0.5 text-[9px] text-white/75">{sub}</p>}</div>
)
const Card = ({ children, className = '' }: { children: ReactNode; className?: string }) => <div className={`rounded-xl bg-white p-2.5 shadow-[0_1px_4px_rgb(11_27_51/0.08)] ${className}`}>{children}</div>
const naira = (n: number) => '₦' + n.toLocaleString('en-NG')

export function SalesScreen() {
  const lines: [string, string, number][] = [['Rice 50kg', '1 ×', 78000], ['Groundnut oil 5L', '2 ×', 13000], ['Sugar 1kg', '3 ×', 5700]]
  return (
    <div className={shell}>
      <Head title="Sales" sub="Bright Mart · Till 1" />
      <div className="flex-1 space-y-2 overflow-hidden p-3">
        <div className="flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-2 text-ink/45 shadow-[0_1px_3px_rgb(11_27_51/0.07)]"><Search className="size-3" aria-hidden /> Scan or search an item</div>
        <Card className="space-y-1.5">{lines.map(([n, q, v]) => <div key={n} className="flex items-center justify-between"><span><b className="font-semibold">{n}</b><span className="ml-1 text-ink/50">{q}</span></span><span className="tabular font-semibold">{naira(v)}</span></div>)}</Card>
        <div className="flex gap-1.5">{['Cash', 'Transfer', 'POS'].map((m, i) => <span key={m} className={`flex-1 rounded-lg py-1.5 text-center font-semibold ${i === 0 ? 'bg-brand text-white' : 'bg-white text-ink/70 shadow-[0_1px_3px_rgb(11_27_51/0.07)]'}`}>{m}</span>)}</div>
      </div>
      <div className="space-y-1.5 border-t border-line bg-white p-3"><div className="flex justify-between text-[11px]"><span className="text-ink/60">Total</span><b className="tabular text-[13px]">{naira(96700)}</b></div><div className="rounded-xl bg-amber py-2.5 text-center text-[12px] font-extrabold">Charge {naira(96700)}</div></div>
    </div>
  )
}

export function DashboardScreen() {
  const pts = [18, 24, 20, 31, 27, 38, 34, 46, 41, 55, 49, 62]
  const w = 200, h = 54
  const line = pts.map((v, i) => `${i ? 'L' : 'M'}${(i / (pts.length - 1)) * w} ${h - (v / 66) * h}`).join(' ')
  return (
    <div className={shell}>
      <Head title="Good morning, Ada" sub="Here is today at Bright Mart" />
      <div className="flex-1 space-y-2 overflow-hidden p-3">
        <div className="grid grid-cols-2 gap-2">
          <Card><p className="text-ink/55">Sales today</p><p className="tabular mt-0.5 text-[14px] font-extrabold">{naira(412500)}</p><p className="mt-0.5 font-semibold text-success">▲ 12% on yesterday</p></Card>
          <Card><p className="text-ink/55">Orders</p><p className="tabular mt-0.5 text-[14px] font-extrabold">38</p><p className="mt-0.5 font-semibold text-success">▲ 5 more</p></Card>
        </div>
        <Card><p className="mb-1 font-semibold">This week</p><svg viewBox={`0 0 ${w} ${h + 4}`} className="h-16 w-full" aria-hidden><defs><linearGradient id="spark" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#00b4d8" stopOpacity="0.35" /><stop offset="1" stopColor="#00b4d8" stopOpacity="0" /></linearGradient></defs><path d={`${line} L${w} ${h + 4} L0 ${h + 4} Z`} fill="url(#spark)" /><path d={line} fill="none" stroke="#0077b6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></Card>
        <Card className="flex items-center gap-2 bg-warning-soft"><TriangleAlert className="size-3.5 text-warning" aria-hidden /><span><b>3 items</b> are running low</span><ChevronRight className="ml-auto size-3 text-ink/40" aria-hidden /></Card>
      </div>
    </div>
  )
}

export function SchoolScreen() {
  const kids: [string, 'p' | 'a' | 'l'][] = [['Ada Obi', 'p'], ['Bayo Ade', 'p'], ['Chidi Eze', 'a'], ['Dayo Ade', 'p'], ['Emeka Nwosu', 'l'], ['Funke Bello', 'p']]
  const tone = { p: 'bg-success text-white', a: 'bg-danger text-white', l: 'bg-amber text-ink' } as const
  const word = { p: 'Present', a: 'Absent', l: 'Late' } as const
  return (
    <div className={shell}>
      <Head title="Attendance" sub="Primary 3 · Monday" color="bg-[#5f3dc4]" />
      <div className="flex-1 overflow-hidden p-3">
        <div className="mb-2 flex items-center justify-between"><span className="font-semibold">22 pupils</span><span className="rounded-full bg-white px-2 py-0.5 font-semibold text-success shadow-[0_1px_3px_rgb(11_27_51/0.08)]">18 marked</span></div>
        <Card className="divide-y divide-ink/10 !p-0">{kids.map(([n, s]) => <div key={n} className="flex items-center gap-2 px-2.5 py-2"><span className="grid size-6 place-items-center rounded-full bg-accent-soft text-[8px] font-bold text-accent">{n.split(' ').map((x) => x[0]).join('')}</span><span className="flex-1 font-semibold">{n}</span><span className={`rounded-full px-2 py-0.5 text-[8.5px] font-bold ${tone[s]}`}>{word[s]}</span></div>)}</Card>
      </div>
      <div className="border-t border-line bg-white p-3"><div className="rounded-xl bg-[#5f3dc4] py-2.5 text-center text-[12px] font-extrabold text-white">Save register</div></div>
    </div>
  )
}

export function FarmScreen() {
  const bars = [62, 70, 66, 78, 74, 88, 94]
  return (
    <div className={shell}>
      <Head title="Poultry" sub="Pen 2 · Layers · 1,300 birds" color="bg-[#2f7d32]" />
      <div className="flex-1 space-y-2 overflow-hidden p-3">
        <div className="grid grid-cols-2 gap-2">
          <Card><p className="flex items-center gap-1 text-ink/55"><Egg className="size-3" aria-hidden /> Eggs today</p><p className="tabular mt-0.5 text-[15px] font-extrabold">1,240</p><p className="text-ink/50">41 crates</p></Card>
          <Card><p className="flex items-center gap-1 text-ink/55"><Wheat className="size-3" aria-hidden /> Feed used</p><p className="tabular mt-0.5 text-[15px] font-extrabold">3.5 bags</p><p className="text-success">On target</p></Card>
        </div>
        <Card><p className="mb-1.5 font-semibold">Laying rate · 7 days</p><div className="flex h-16 items-end gap-1.5">{bars.map((b, i) => <span key={i} className={`flex-1 rounded-t ${i === bars.length - 1 ? 'bg-[#2f7d32]' : 'bg-[#2f7d32]/35'}`} style={{ height: `${b}%` }} />)}</div></Card>
        <Card className="flex items-center gap-2"><Droplets className="size-3.5 text-accent" aria-hidden /><span>Vaccination due <b>Thursday</b></span></Card>
      </div>
    </div>
  )
}

export function BakeryScreen() {
  const bakes: [string, number, string][] = [['Sliced bread', 80, '120 loaves'], ['Meat pie', 55, '200 pieces'], ['Doughnuts', 100, '90 pieces'], ['Buns', 25, '150 pieces']]
  return (
    <div className={shell}>
      <Head title="Today's bakes" sub="Oven 1 and 2" color="bg-[#d9480f]" />
      <div className="flex-1 space-y-2 overflow-hidden p-3">
        {bakes.map(([n, p, q]) => <Card key={n}><div className="flex justify-between"><b className="font-semibold">{n}</b><span className="text-ink/55">{q}</span></div><div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink/10"><span className="block h-full rounded-full bg-[#d9480f]" style={{ width: `${p}%` }} /></div><p className="mt-1 text-[9px] text-ink/55">{p === 100 ? 'Done · ready to sell' : `${p}% baked`}</p></Card>)}
      </div>
    </div>
  )
}

export function PharmacyScreen() {
  const items: [string, string, 'r' | 'a' | 'g'][] = [['Amoxicillin 500mg', '9 days', 'r'], ['Paracetamol 500mg', '24 days', 'a'], ['Vitamin C 1000mg', '3 months', 'g'], ['ORS sachets', '5 months', 'g']]
  const tone = { r: 'bg-danger-soft text-danger', a: 'bg-warning-soft text-warning', g: 'bg-success-soft text-success' } as const
  return (
    <div className={shell}>
      <Head title="Expiry watch" sub="Batches to sell or return first" color="bg-[#0ca678]" />
      <div className="flex-1 space-y-2 overflow-hidden p-3">
        <Card className="divide-y divide-ink/10 !p-0">{items.map(([n, d, t]) => <div key={n} className="flex items-center gap-2 px-2.5 py-2.5"><span className="grid size-6 place-items-center rounded-lg bg-[#0ca678]/15 text-[#0ca678]"><Pill className="size-3" aria-hidden /></span><span className="flex-1 font-semibold">{n}</span><span className={`rounded-full px-2 py-0.5 text-[8.5px] font-bold ${tone[t]}`}>{d}</span></div>)}</Card>
        <div className="rounded-xl bg-[#0ca678] py-2.5 text-center text-[12px] font-extrabold text-white">Dispense</div>
      </div>
    </div>
  )
}

export function ReceiptScreen() {
  return (
    <div className={shell}>
      <Head title="Fee receipt" sub="RCT-000123 · Bright Future Academy" color="bg-[#5f3dc4]" />
      <div className="flex-1 space-y-2 overflow-hidden p-3">
        <Card className="space-y-1.5"><div className="flex justify-between"><span className="text-ink/55">Student</span><b>Ada Obi · Primary 1</b></div><div className="flex justify-between"><span className="text-ink/55">Term</span><b>First Term</b></div><div className="h-px bg-ink/10" />
          {[['Tuition', 40000], ['Textbooks', 8000]].map(([n, v]) => <div key={n} className="flex justify-between"><span>{n}</span><span className="tabular">{naira(v as number)}</span></div>)}<div className="flex justify-between font-bold"><span>Paid today</span><span className="tabular">{naira(20000)}</span></div></Card>
        <div className="flex items-center justify-center gap-1.5 rounded-xl bg-success-soft py-2.5 font-bold text-success"><Check className="size-3.5" aria-hidden /> Paid · balance {naira(28000)}</div>
      </div>
      <div className="flex gap-2 border-t border-line bg-white p-3"><span className="flex-1 rounded-xl bg-amber py-2.5 text-center text-[11px] font-extrabold">Print</span><span className="flex-1 rounded-xl bg-white py-2.5 text-center text-[11px] font-bold ring-1 ring-ink/20">Share</span></div>
    </div>
  )
}

export interface PhoneScreen { id: string; label: string; node: ReactNode }
export const SCREENS: Record<string, PhoneScreen> = {
  sales: { id: 'sales', label: 'Sales till', node: <SalesScreen /> },
  dashboard: { id: 'dashboard', label: 'Daily dashboard', node: <DashboardScreen /> },
  school: { id: 'school', label: 'School attendance', node: <SchoolScreen /> },
  farm: { id: 'farm', label: 'Poultry records', node: <FarmScreen /> },
  bakery: { id: 'bakery', label: 'Bakery batches', node: <BakeryScreen /> },
  pharmacy: { id: 'pharmacy', label: 'Pharmacy expiry', node: <PharmacyScreen /> },
  receipt: { id: 'receipt', label: 'Fee receipt', node: <ReceiptScreen /> },
}
/** The screen that best shows each industry. */
export const INDUSTRY_SCREEN: Record<string, string> = { retail: 'sales', farm: 'farm', bakery: 'bakery', pharmacy: 'pharmacy', school: 'school' }
