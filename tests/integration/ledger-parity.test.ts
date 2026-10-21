import { beforeAll, expect, it } from 'vitest'
import { applyMovement } from '@/modules/inventory/ledger'
import type { Balance } from '@/modules/inventory/ledger'
import { asUser, createDb, createUser, rows } from '../helpers/harness'

// Same scenario through the real SQL and the TypeScript mirror used by demo mode.
const steps: { delta: number; cost: number | null }[] = [
  { delta: 10, cost: 100 }, { delta: 10, cost: 200 }, { delta: -4, cost: null }, { delta: 5, cost: null },
  { delta: 3, cost: 175.5 }, { delta: -2, cost: null }, { delta: -22, cost: null }, { delta: 7, cost: 33.3333 },
  { delta: 0.25, cost: 80 }, { delta: -7.25, cost: null },
]

let db: Awaited<ReturnType<typeof createDb>>
beforeAll(async () => { db = await createDb() })

it('SQL ledger and TypeScript ledger agree on quantity and weighted-average cost', async () => {
  const owner = await createUser(db, 'o@example.com')
  const biz = (await asUser(db, owner, () => rows<{ id: string }>(db, `select public.create_business('P','retail') as id`)))[0].id
  const unit = (await rows<{ id: string }>(db, `select id from public.units_of_measure where business_id=$1 and code='each'`, [biz]))[0].id
  const loc = (await rows<{ id: string }>(db, 'select id from public.inventory_locations where business_id=$1', [biz]))[0].id
  const prod = (await asUser(db, owner, () => rows<{ id: string }>(db,
    `insert into public.products (business_id,name,base_unit_id,default_purchase_cost) values ($1,'X',$2,40) returning id`, [biz, unit])))[0].id

  let bal: Balance = { qty: 0, avg: null }
  for (const [i, s] of steps.entries()) {
    const type = s.delta > 0 ? 'receipt' : 'issue'
    await db.exec(`select public._post_movement('${biz}','${prod}','${loc}','${type}',${s.delta},${s.cost ?? 'null'},'t',null,gen_random_uuid(),'${type === 'issue' ? 'parity issue' : 'null'}')`.replace("'null')", 'null)'))
    bal = applyMovement(bal, s.delta, s.cost, { allowNegative: false, defaultCost: 40 }).balance
    const [row] = await rows<{ quantity_on_hand: string; avg_unit_cost: string }>(db,
      'select quantity_on_hand, avg_unit_cost from public.inventory_balances where product_id=$1 and location_id=$2', [prod, loc])
    expect(Number(row.quantity_on_hand), `qty after step ${i}`).toBeCloseTo(bal.qty, 4)
    expect(Number(row.avg_unit_cost), `avg after step ${i}`).toBeCloseTo(bal.avg ?? 0, 4)
  }
})
