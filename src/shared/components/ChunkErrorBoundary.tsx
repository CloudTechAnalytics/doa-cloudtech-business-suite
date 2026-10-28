import { Component } from 'react'
import type { ReactNode } from 'react'
import { isChunkLoadError, reloadForNewVersion } from '@/shared/utilities/chunkReload'

/**
 * Catches a page that failed to load. When the cause is a new release (the page file it wanted is gone) the app reloads itself once; otherwise, or if that did not
 * help, the person sees what happened and a button, instead of a blank screen.
 */
export class ChunkErrorBoundary extends Component<{ children: ReactNode }, { error: unknown | null }> {
  state = { error: null as unknown | null }
  static getDerivedStateFromError(error: unknown) { return { error } }
  componentDidCatch(error: unknown) { if (isChunkLoadError(error)) reloadForNewVersion() }
  render() {
    if (this.state.error === null) return this.props.children
    const update = isChunkLoadError(this.state.error)
    return (
      <div role="alert" className="mx-auto max-w-md rounded-lg border border-line bg-white p-6 text-center shadow-card">
        <h2 className="text-lg font-bold">{update ? 'DOA was updated' : 'This page could not be shown'}</h2>
        <p className="mt-2 text-sm text-ink/70">{update ? 'A newer version is available. Reload to continue; your work is saved.' : 'Something went wrong while opening it. Reloading usually fixes it.'}</p>
        <button type="button" onClick={() => window.location.reload()} className="mt-4 inline-flex h-10 items-center rounded-md bg-amber px-4 text-sm font-bold text-ink hover:bg-amber-dark">Reload</button>
      </div>
    )
  }
}
