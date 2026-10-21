import clsx from 'clsx'
import { AlertTriangle, Inbox, Loader2 } from 'lucide-react'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'
import { useId } from 'react'

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
        'inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-md px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        variant === 'primary' && 'bg-gold text-navy hover:bg-gold-dark hover:text-white',
        variant === 'secondary' && 'border border-navy/20 bg-white text-navy hover:bg-surface',
        variant === 'ghost' && 'text-navy hover:bg-navy/5',
        className,
      )}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  )
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={clsx('min-w-0 rounded-lg border border-navy/10 bg-white p-5 shadow-card', className)}>{children}</section>
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="font-brand text-[26px] font-semibold leading-tight text-navy">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-navy/70">{description}</p>}
      </div>
      {actions}
    </header>
  )
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed border-navy/20 bg-white px-6 py-12 text-center">
      <Inbox className="mb-3 size-8 text-gold" aria-hidden />
      <h2 className="text-base font-semibold text-navy">{title}</h2>
      {description && <p className="mt-1 max-w-md text-sm text-navy/70">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function ErrorState({ title = 'Something went wrong', message }: { title?: string; message: string }) {
  return (
    <div role="alert" className="flex gap-3 rounded-xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div>
        <p className="font-semibold">{title}</p>
        <p>{message}</p>
      </div>
    </div>
  )
}

export function Notice({ children }: { children: ReactNode }) {
  return <div role="status" className="rounded-lg border border-gold/50 bg-gold/10 p-3 text-sm text-navy">{children}</div>
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 py-12 text-sm text-navy/70">
      <Loader2 className="size-5 animate-spin" aria-hidden /> {label}…
    </div>
  )
}

const fieldClass =
  'min-h-10 w-full rounded-lg border border-navy/20 bg-white px-3 text-sm text-navy placeholder:text-navy/40 aria-[invalid=true]:border-danger'

function Field({ label, error, hint, children, id }: { label: string; error?: string; hint?: string; children: ReactNode; id: string }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-navy">{label}</label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-navy/60">{hint}</p>}
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

type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'gold'
const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-navy/5 text-navy/70',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
  gold: 'bg-gold/15 text-gold-ink',
}

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={clsx('inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium', TONES[tone])}>{children}</span>
}
