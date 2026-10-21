import { useRef } from 'react'

/** One key per form attempt: retries and double-clicks reuse it; success renews it. */
export function useIdempotencyKey() {
  const ref = useRef(crypto.randomUUID())
  return { current: () => ref.current, renew: () => { ref.current = crypto.randomUUID() } }
}
