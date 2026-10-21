import { createContext, useContext } from 'react'

/** The shell sets this to the current app's name so page headers can show a breadcrumb ("Sales / New sale"). */
export const CrumbContext = createContext<string | null>(null)
export const useCrumb = () => useContext(CrumbContext)
