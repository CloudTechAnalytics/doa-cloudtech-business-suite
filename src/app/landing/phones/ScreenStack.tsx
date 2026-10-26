import { SCREENS } from './screens'

/** Several app screens stacked inside one phone: the active one is in view, the others wait just off to the side, and moving between them slides and fades. */
export function ScreenStack({ ids, active }: { ids: string[]; active: number }) {
  const n = ids.length
  return (
    <>
      {ids.map((id, i) => {
        const off = ((i - active + n + Math.floor(n / 2)) % n) - Math.floor(n / 2) // -half .. +half, 0 is the screen in view
        return (
          <div key={id} aria-hidden={off !== 0} className="absolute inset-0 transition-[transform,opacity] duration-700 ease-[cubic-bezier(0.3,0.7,0.2,1)]"
            style={{ transform: `translateX(${off * 28}%) scale(${off === 0 ? 1 : 0.96})`, opacity: off === 0 ? 1 : 0, pointerEvents: off === 0 ? 'auto' : 'none' }}>
            {SCREENS[id].node}
          </div>
        )
      })}
    </>
  )
}
