import type { SetupAnswerValue, SetupQuestion } from '@/core/industry-registry/types'
import { SelectField, TextField } from '@/shared/components'

/** Renders an industry's setup questions. Answers are validated by validateSetupAnswers() and again by the database. */
export function SetupFields({ questions, answers, errors, onChange }: {
  questions: SetupQuestion[]
  answers: Record<string, SetupAnswerValue>
  errors: Record<string, string>
  onChange: (id: string, value: SetupAnswerValue) => void
}) {
  return (
    <>
      {questions.map((q) => {
        if (q.type === 'boolean') {
          return (
            <label key={q.id} className="flex items-start gap-2 text-sm sm:col-span-2">
              <input type="checkbox" className="mt-1" checked={answers[q.id] === true} onChange={(e) => onChange(q.id, e.target.checked)} />
              <span>{q.label}{q.help && <span className="block text-xs text-navy/60">{q.help}</span>}{errors[q.id] && <span className="block text-xs text-danger">{errors[q.id]}</span>}</span>
            </label>
          )
        }
        if (q.type === 'select') {
          return (
            <SelectField key={q.id} label={q.label} hint={q.help} error={errors[q.id]} value={String(answers[q.id] ?? '')} onChange={(e) => onChange(q.id, e.target.value)}>
              <option value="">Select…</option>
              {q.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </SelectField>
          )
        }
        return (
          <TextField
            key={q.id} label={q.label} hint={q.help} error={errors[q.id]} type={q.type === 'number' ? 'number' : 'text'}
            step={q.type === 'number' ? 'any' : undefined} min={q.min} max={q.max} value={String(answers[q.id] ?? '')}
            onChange={(e) => onChange(q.id, e.target.value)}
          />
        )
      })}
    </>
  )
}
