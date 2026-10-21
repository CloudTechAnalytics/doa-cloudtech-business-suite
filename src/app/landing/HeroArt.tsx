import { Croissant, ShoppingBasket, Tractor } from 'lucide-react'
import type { CSSProperties } from 'react'

const d = (ms: number) => ({ '--d': `${ms}ms` }) as CSSProperties

/** A soft landscape that sits behind the hero: farm, shop and bakery on rolling fields. Transparent and decorative. */
export function HeroArt() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* colour washes */}
      <div className="absolute -left-40 -top-40 size-[34rem] rounded-full bg-mint/20 blur-3xl" />
      <div className="absolute -right-32 top-10 size-[30rem] rounded-full bg-[#fbb130]/25 blur-3xl" />
      <div className="absolute bottom-0 left-1/3 size-[28rem] rounded-full bg-[#1bb6f9]/15 blur-3xl" />
      {/* faint dot grid, fading downward */}
      <div className="absolute inset-0 opacity-60 [background-image:radial-gradient(rgb(11_42_74/0.14)_1px,transparent_1px)] [background-size:26px_26px] [mask-image:linear-gradient(to_bottom,black,transparent_70%)]" />

      {/* sun */}
      <div className="anim-sun absolute right-[9%] top-[14%] size-28 rounded-full bg-[radial-gradient(circle,#ffe08a_0%,#fbb130_55%,transparent_72%)] opacity-80 sm:size-36" />

      {/* clouds */}
      <svg className="anim-drift absolute left-[6%] top-[10%] w-44 text-white" viewBox="0 0 160 60" fill="currentColor" style={d(0)}><ellipse cx="60" cy="38" rx="48" ry="18" opacity=".9" /><ellipse cx="96" cy="30" rx="38" ry="20" opacity=".95" /><ellipse cx="44" cy="30" rx="26" ry="16" /></svg>
      <svg className="anim-drift absolute right-[28%] top-[6%] hidden w-32 text-white sm:block" viewBox="0 0 160 60" fill="currentColor" style={d(-12000)}><ellipse cx="60" cy="38" rx="48" ry="18" opacity=".85" /><ellipse cx="98" cy="30" rx="36" ry="19" opacity=".9" /></svg>

      {/* floating app chips, wide screens only so they never crowd the headline */}
      <Chip className="left-[5%] top-[30%]" icon={Tractor} color="#5c940d" label="Farm" delay={900} />
      <Chip className="right-[6%] top-[34%]" icon={ShoppingBasket} color="#1971c2" label="Retail" delay={1100} />
      <Chip className="left-[12%] top-[56%]" icon={Croissant} color="#d9480f" label="Bakery" delay={1300} />

      {/* landscape */}
      <svg className="absolute inset-x-0 bottom-0 h-[48%] min-h-[240px] w-full [mask-image:linear-gradient(to_top,black_72%,transparent)]" viewBox="0 0 1440 420" preserveAspectRatio="xMidYMax slice">
        <path d="M0 260 C180 200 340 232 520 214 S860 168 1040 214 S1320 240 1440 198 V420 H0Z" fill="#0b2a4a" opacity=".07" />
        <path d="M0 300 C220 250 420 292 640 270 S1000 234 1220 276 S1380 290 1440 268 V420 H0Z" fill="#5c940d" opacity=".17" />
        {/* field rows */}
        {[0, 1, 2, 3, 4].map((i) => <path key={i} d={`M${420 + i * 34} 420 C${520 + i * 40} 340 ${640 + i * 30} 310 ${760 + i * 36} 286`} fill="none" stroke="#5c940d" strokeWidth="2" opacity=".22" />)}
        <path d="M0 346 C200 312 420 346 680 332 S1080 300 1300 336 S1400 342 1440 332 V420 H0Z" fill="#017e84" opacity=".2" />

        {/* barn + silo */}
        <g>
          <rect x="130" y="244" width="150" height="72" rx="4" fill="#e03131" opacity=".82" />
          <polygon points="114,246 205,186 296,246" fill="#a61e1e" opacity=".92" />
          <rect x="180" y="266" width="50" height="50" fill="#fff" opacity=".75" />
          <path d="M180 266 L230 316 M230 266 L180 316" stroke="#e03131" strokeWidth="3" opacity=".7" />
          <circle cx="205" cy="224" r="9" fill="#fff" opacity=".8" />
          <rect x="288" y="218" width="34" height="98" rx="6" fill="#adb5bd" opacity=".8" />
          <path d="M288 222 Q305 196 322 222Z" fill="#868e96" opacity=".9" />
        </g>
        {/* fence */}
        <g stroke="#a47551" strokeWidth="3" opacity=".6" strokeLinecap="round">
          {Array.from({ length: 9 }, (_, i) => <path key={i} d={`M${340 + i * 26} 322 V${304 + (i % 2) * 2}`} />)}
          <path d="M340 312 H548 M340 322 H548" />
        </g>
        {/* trees */}
        <g>
          <rect x="454" y="272" width="8" height="44" fill="#7a5230" opacity=".7" />
          <circle cx="458" cy="262" r="30" fill="#2f9e44" opacity=".62" />
          <circle cx="438" cy="276" r="20" fill="#2f9e44" opacity=".55" />
          <rect x="934" y="282" width="7" height="36" fill="#7a5230" opacity=".7" />
          <circle cx="938" cy="274" r="24" fill="#2f9e44" opacity=".6" />
        </g>
        {/* wheat */}
        <g stroke="#e8a317" strokeWidth="2.5" strokeLinecap="round" opacity=".75">
          {Array.from({ length: 7 }, (_, i) => (
            <g key={i} className="anim-sway" style={d(i * 260)}>
              <path d={`M${590 + i * 16} 340 V${296 - (i % 3) * 8}`} />
              <ellipse cx={590 + i * 16} cy={292 - (i % 3) * 8} rx="3.5" ry="9" fill="#f2c14e" stroke="none" />
            </g>
          ))}
        </g>
        {/* shop */}
        <g>
          <rect x="1010" y="240" width="172" height="78" fill="#1971c2" opacity=".82" />
          <rect x="1030" y="262" width="46" height="40" fill="#fff" opacity=".78" />
          <rect x="1090" y="262" width="26" height="56" fill="#0b2a4a" opacity=".7" />
          <rect x="1128" y="262" width="40" height="40" fill="#fff" opacity=".78" />
          {Array.from({ length: 8 }, (_, i) => <path key={i} d={`M${1000 + i * 24} 228 h24 v16 a12 12 0 0 1 -24 0Z`} fill={i % 2 ? '#ffffff' : '#fbb130'} opacity=".92" />)}
          <rect x="1000" y="222" width="192" height="8" rx="3" fill="#0b2a4a" opacity=".5" />
        </g>
        {/* bakery */}
        <g>
          <rect x="1236" y="260" width="124" height="58" fill="#d9480f" opacity=".82" />
          <polygon points="1226,262 1298,222 1370,262" fill="#7a2e12" opacity=".9" />
          <rect x="1328" y="196" width="18" height="52" fill="#7a2e12" opacity=".9" />
          <path d="M1262 318 V286 a16 16 0 0 1 32 0 V318Z" fill="#ffd966" opacity=".9" />
          <rect x="1306" y="280" width="40" height="22" rx="3" fill="#fff" opacity=".75" />
          {[0, 1, 2].map((i) => <circle key={i} cx={1337 + i * 3} cy="190" r={7 + i * 2} fill="#fff" className="anim-smoke" style={d(i * 1500)} />)}
        </g>
      </svg>
    </div>
  )
}

function Chip({ className, icon: Icon, color, label, delay }: { className: string; icon: typeof Tractor; color: string; label: string; delay: number }) {
  return (
    <div className={`absolute hidden xl:block ${className}`}>
      <div className="anim-pop" style={d(delay)}>
        <div className="anim-float flex items-center gap-3 rounded-2xl bg-white/85 p-3 pr-5 shadow-raised ring-1 ring-white" style={d(delay)}>
          <span className="grid size-10 place-items-center rounded-xl text-white" style={{ background: color }}><Icon className="size-5" strokeWidth={1.75} /></span>
          <span>
            <span className="block text-sm font-semibold text-ink">{label}</span>
            <span className="mt-1.5 flex gap-1"><span className="h-1.5 w-10 rounded-full" style={{ background: `${color}55` }} /><span className="h-1.5 w-5 rounded-full bg-line" /></span>
          </span>
        </div>
      </div>
    </div>
  )
}
