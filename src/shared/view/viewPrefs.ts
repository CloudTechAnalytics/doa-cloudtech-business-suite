import { useSyncExternalStore } from 'react'

/**
 * How a person likes to see lists and records. It is a personal choice kept in this browser, not a business setting, so it never affects anyone else.
 *   list:   'table' (rows) or 'grid' (cards) for every list of records
 *   detail: 'page' (a record opens in place of the list) or 'panel' (it opens in a panel beside the list, so the list stays in view)
 */
export type ListStyle = 'table' | 'grid'
export type DetailStyle = 'page' | 'panel'
export interface ViewPrefs { list: ListStyle; detail: DetailStyle }

const KEY = 'doa.view.v1'
const DEFAULTS: ViewPrefs = { list: 'table', detail: 'page' }

function read(): ViewPrefs {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<ViewPrefs>
    return { list: v.list === 'grid' ? 'grid' : 'table', detail: v.detail === 'panel' ? 'panel' : 'page' }
  } catch { return DEFAULTS }
}

let state = read()
const listeners = new Set<() => void>()
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }

export function setViewPrefs(patch: Partial<ViewPrefs>) {
  state = { ...state, ...patch }
  try { localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* storage unavailable */ }
  listeners.forEach((l) => l())
}

export const useViewPrefs = () => useSyncExternalStore(subscribe, () => state, () => DEFAULTS)
