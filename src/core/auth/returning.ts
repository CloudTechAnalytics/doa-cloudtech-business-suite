/** What this browser remembers about a person's visits, so the website's front page is not the first thing a returning member sees. Everything is optional: storage can be blocked. */
const RETURNING = 'doa.returning', ENTERED = 'doa.entered', SIGNED_OUT = 'doa.signedOut'

const read = (s: () => Storage, k: string) => { try { return s().getItem(k) } catch { return null } }
const write = (s: () => Storage, k: string, v: string | null) => { try { if (v === null) s().removeItem(k); else s().setItem(k, v) } catch { /* storage blocked: nothing to remember */ } }
const local = () => localStorage, session = () => sessionStorage

/** Called once someone has signed in on this browser. */
export const markReturning = () => write(local, RETURNING, '1')
export const isReturning = () => read(local, RETURNING) === '1'

/** True only for the first time the front page is opened in a tab; later visits to it, from links on the website, show the page. */
let first: boolean | null = null // decided once per page load, so rendering twice gives the same answer
export function firstEntry(): boolean { if (first === null) { first = read(session, ENTERED) === null; write(session, ENTERED, '1') } return first }
/** Called once the front page has been shown or left, so opening it again from a link on the website shows it. */
export const entryDone = () => { first = false }

/** Where the front page sends someone who has just opened the website's address, or null to show the page. */
export const homeRedirect = (signedIn: boolean, first: boolean, returning: boolean): '/businesses' | '/sign-in' | null =>
  !first ? null : signedIn ? '/businesses' : returning ? '/sign-in' : null

export const markSignedOut = () => write(session, SIGNED_OUT, '1')
/** True once after signing out, so the sign-in page can say it worked. */
export function takeSignedOut(): boolean { const v = read(session, SIGNED_OUT) === '1'; if (v) write(session, SIGNED_OUT, null); return v }
