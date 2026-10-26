import clsx from 'clsx'
import { AlertTriangle, Inbox, Loader2 } from 'lucide-react'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'
import { useId } from 'react'
import { useCrumb } from './breadcrumb'

type Variant = 'primary' | 'secondary' | 'ghost'

export function Button({
  variant = 'primary',
  loading,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex min-h-9 items-center justify-center gap-2 whitespace-nowrap rounded-md px-3.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        variant === 'primary' && 'bg-amber font-semibold text-ink hover:bg-amber-dark',
        variant === 'secondary' && 'border border-line bg-white text-ink shadow-pill hover:bg-surface',
        variant === 'ghost' && 'text-brand-ink hover:bg-brand/10',
        className,
      )}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  )
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={clsx('min-w-0 rounded-lg border border-line bg-white p-5 shadow-card', className)}>{children}</section>
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  const crumb = useCrumb()
  return (
    <header className="mb-5 flex flex-wrap items-start justify-between gap-3 rounded-lg border border-line bg-white px-4 py-3 shadow-card">
      <div className="min-w-0">
        {crumb && crumb !== title && <p className="mb-0.5 text-xs text-ink/50">{crumb}</p>}
        <h1 className="text-xl font-semibold leading-tight text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-ink/65">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed border-ink/20 bg-white px-6 py-12 text-center">
      <Inbox className="mb-3 size-8 text-brand" aria-hidden />
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      {description && <p className="mt-1 max-w-md text-sm text-ink/70">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function ErrorState({ title = 'Something went wrong', message }: { title?: string; message: string }) {
  return (
    <div role="alert" className="flex gap-3 rounded-lg border border-danger/30 bg-danger-soft p-4 text-sm text-danger">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div>
        <p className="font-semibold">{title}</p>
        <p>{message}</p>
      </div>
    </div>
  )
}

export function Notice({ children }: { children: ReactNode }) {
  return <div role="status" className="rounded-lg border border-amber/50 bg-amber/10 p-3 text-sm text-ink">{children}</div>
}

/** Page and panel loader: centred in the space it fills, in the colours of the current theme. */
export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="grid min-h-[45vh] w-full place-items-center px-4 py-10">
      <div className="flex flex-col items-center gap-5">
        <div className="loader" aria-hidden><span className="loader-ring" /><span className="loader-ring loader-ring-2" /><span className="loader-core" /></div>
        <p className="flex items-baseline text-sm font-medium tracking-wide text-ink/70">{label}<span className="loader-dots" aria-hidden><i>.</i><i>.</i><i>.</i></span></p>
      </div>
    </div>
  )
}

const fieldClass =
  'min-h-9 w-full rounded-md border border-ink/20 bg-white px-3 text-sm text-ink placeholder:text-ink/40 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand aria-[invalid=true]:border-danger'

function Field({ label, error, hint, children, id }: { label: string; error?: string; hint?: string; children: ReactNode; id: string }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-ink">{label}</label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-ink/60">{hint}</p>}
      {error && <p id={`${id}-err`} className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  )
}

export function TextField({ label, error, hint, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string }) {
  const id = useId()
  return (
    <Field id={id} label={label} error={error} hint={hint}>
      <input id={id} {...rest} aria-invalid={!!error} aria-describedby={error ? `${id}-err` : undefined} className={clsx(fieldClass, rest.className)} />
    </Field>
  )
}

export function SelectField({
  label,
  error,
  hint,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; error?: string; hint?: string }) {
  const id = useId()
  return (
    <Field id={id} label={label} error={error} hint={hint}>
      <select id={id} {...rest} aria-invalid={!!error} aria-describedby={error ? `${id}-err` : undefined} className={clsx(fieldClass, rest.className)}>
        {children}
      </select>
    </Field>
  )
}

type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'brand'
const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-ink/5 text-ink/70',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
  brand: 'bg-brand/15 text-brand-ink',
}

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={clsx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium', TONES[tone])}>{children}</span>
}
