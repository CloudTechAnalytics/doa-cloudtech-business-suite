/** Hero background: soft colour washes and a faint dot grid. No objects, nothing floating. */
export function HeroBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div className="absolute -left-40 -top-40 size-[34rem] rounded-full bg-mint/20 blur-3xl" />
      <div className="absolute -right-32 top-10 size-[30rem] rounded-full bg-amber/25 blur-3xl" />
      <div className="absolute bottom-0 left-1/3 size-[28rem] rounded-full bg-mint/20 blur-3xl" />
      <div className="absolute inset-0 opacity-60 [background-image:radial-gradient(rgb(11_42_74/0.14)_1px,transparent_1px)] [background-size:26px_26px] [mask-image:linear-gradient(to_bottom,black,transparent_70%)]" />
    </div>
  )
}
