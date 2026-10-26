import type { ReactNode } from 'react'
import type { SPeriod } from '../services/schoolApi'

/** A week laid out as periods down the side and school days across the top. Breaks are drawn as a single band. `cell` draws what goes in a lesson slot. */
export function TimetableGrid({ periods, days, cell }: { periods: SPeriod[]; days: readonly (readonly [number, string])[]; cell: (day: number, period: SPeriod) => ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table data-keep-table className="w-full min-w-[40rem] border-separate border-spacing-0 text-sm">
        <thead>
          <tr><th className="sticky left-0 z-10 w-28 bg-surface p-2 text-left text-xs font-semibold text-ink/70">Period</th>{days.map(([n, d]) => <th key={n} className="bg-surface p-2 text-left text-xs font-semibold text-ink/70">{d}</th>)}</tr>
        </thead>
        <tbody>
          {periods.map((p) => (
            <tr key={p.id}>
              <th scope="row" className="sticky left-0 z-10 border-t border-line bg-white p-2 text-left align-top"><span className="block font-semibold">{p.label}</span><span className="block text-xs font-normal text-ink/60">{p.startsAt} to {p.endsAt}</span></th>
              {p.isBreak
                ? <td colSpan={days.length} className="border-t border-line bg-canvas p-2 text-center text-xs font-medium uppercase tracking-wide text-ink/50">{p.label}</td>
                : days.map(([n]) => <td key={n} className="min-w-36 border-t border-line p-1.5 align-top">{cell(n, p)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
