import { useState } from 'react'
import { useIdempotencyKey } from './useIdempotencyKey'

/**
 * Runs one write per form attempt: the same idempotency key is reused on retries and double-clicks and
 * renewed only after success, so a repeated submit can never record twice.
 */
export function useFormRunner(onDone: () => Promise<void>) {
  const key = useIdempotencyKey()
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function run(action: (idempotencyKey: string) => Promise<string | null>, success: string, afterSuccess?: () => void) {
    setBusy(true); setOk(null)
    const err = await action(key.current())
    setBusy(false); setError(err)
    if (!err) { key.renew(); setOk(success); afterSuccess?.(); await onDone() }
    return err
  }
  return { error, ok, busy, run, clear: () => { setError(null); setOk(null) } }
}
