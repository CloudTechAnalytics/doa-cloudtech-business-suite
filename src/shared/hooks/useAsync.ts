import { useCallback, useEffect, useRef, useState } from 'react'

/** Loads data when `deps` change and exposes refresh(). Stale responses from a previous business are ignored. */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true })
  const seq = useRef(0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(loader, deps)

  const refresh = useCallback(async () => {
    const mine = ++seq.current
    try {
      const data = await load()
      if (mine === seq.current) setState({ data, error: null, loading: false })
    } catch (e) {
      if (mine === seq.current) setState((s) => ({ ...s, error: (e as Error).message, loading: false }))
    }
  }, [load])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
  }, [refresh])

  return { ...state, refresh }
}
