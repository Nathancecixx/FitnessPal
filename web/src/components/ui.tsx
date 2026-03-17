import { clsx } from 'clsx'
import { useEffect, useState, type PropsWithChildren, type ReactNode } from 'react'

export function PageIntro(props: { eyebrow: string; title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="rounded-[28px] border border-white/10 bg-slate-950/80 p-4 shadow-halo backdrop-blur md:rounded-[32px] md:p-8">
      <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.3em] text-amber-300/80 md:mb-4 md:text-xs">{props.eyebrow}</div>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="font-display text-[2rem] leading-none text-canvas md:text-5xl">{props.title}</h1>
          {props.description ? <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300 md:text-base">{props.description}</p> : null}
        </div>
        {props.actions ? <div className="flex flex-wrap gap-2 md:gap-3">{props.actions}</div> : null}
      </div>
    </div>
  )
}

export function Panel(props: PropsWithChildren<{ title?: string; subtitle?: string; className?: string; action?: ReactNode }>) {
  return (
    <section className={clsx('app-panel rounded-[24px] border p-4 shadow-halo backdrop-blur md:rounded-[28px] md:p-5', props.className)}>
      {(props.title || props.action) ? (
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            {props.title ? <h2 className="app-text-primary font-display text-xl">{props.title}</h2> : null}
            {props.subtitle ? <p className="app-text-muted mt-1 text-sm">{props.subtitle}</p> : null}
          </div>
          {props.action}
        </div>
      ) : null}
      {props.children}
    </section>
  )
}

export function ActionButton(props: PropsWithChildren<{ onClick?: () => void; type?: 'button' | 'submit'; tone?: 'primary' | 'secondary'; className?: string; disabled?: boolean }>) {
  const palette = props.tone === 'secondary'
    ? 'app-button-secondary'
    : 'app-button-primary'
  return (
    <button
      type={props.type ?? 'button'}
      onClick={props.onClick}
      disabled={props.disabled}
      className={clsx('inline-flex min-h-[48px] items-center justify-center rounded-full px-5 py-3 text-sm font-semibold transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 touch-manipulation', palette, props.className)}
    >
      {props.children}
    </button>
  )
}

function FieldMeta(props: { error?: string; hint?: ReactNode }) {
  if (!props.error && !props.hint) {
    return null
  }

  return (
    <div className={clsx('mt-2 text-sm', props.error ? 'text-rose-600' : 'app-text-muted')}>
      {props.error ?? props.hint}
    </div>
  )
}

export function LabelledInput(props: {
  label: string
  type?: string
  value: string | number
  onChange: (value: string) => void
  placeholder?: string
  step?: string
  error?: string
  hint?: ReactNode
}) {
  return (
    <label className="block">
      <span className="app-text-muted mb-2 block text-xs font-semibold uppercase tracking-[0.2em]">{props.label}</span>
      <input
        aria-invalid={Boolean(props.error)}
        className={clsx(
          'app-input w-full rounded-2xl border px-4 py-3 text-[16px] outline-none transition focus:border-amber-400',
          props.error ? 'border-rose-300 focus:border-rose-400' : undefined,
        )}
        type={props.type ?? 'text'}
        value={props.value}
        step={props.step}
        onChange={(event) => props.onChange(event.target.value)}
        placeholder={props.placeholder}
      />
      <FieldMeta error={props.error} hint={props.hint} />
    </label>
  )
}

export function LabelledTextArea(props: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  rows?: number
  error?: string
  hint?: ReactNode
}) {
  return (
    <label className="block">
      <span className="app-text-muted mb-2 block text-xs font-semibold uppercase tracking-[0.2em]">{props.label}</span>
      <textarea
        aria-invalid={Boolean(props.error)}
        className={clsx(
          'app-input w-full rounded-2xl border px-4 py-3 text-[16px] outline-none transition focus:border-amber-400',
          props.error ? 'border-rose-300 focus:border-rose-400' : undefined,
        )}
        value={props.value}
        rows={props.rows ?? 4}
        onChange={(event) => props.onChange(event.target.value)}
        placeholder={props.placeholder}
      />
      <FieldMeta error={props.error} hint={props.hint} />
    </label>
  )
}

export function LabelledSelect(props: {
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<{ label: string; value: string }>
  error?: string
  hint?: ReactNode
}) {
  return (
    <label className="block">
      <span className="app-text-muted mb-2 block text-xs font-semibold uppercase tracking-[0.2em]">{props.label}</span>
      <select
        aria-invalid={Boolean(props.error)}
        className={clsx(
          'app-input w-full rounded-2xl border px-4 py-3 text-[16px] outline-none transition focus:border-amber-400',
          props.error ? 'border-rose-300 focus:border-rose-400' : undefined,
        )}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
      >
        {props.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <FieldMeta error={props.error} hint={props.hint} />
    </label>
  )
}

export function EmptyState(props: { title: string; body: string }) {
  return (
    <div className="app-empty-state rounded-[24px] border border-dashed p-6 text-sm">
      <div className="app-empty-state-title font-display text-lg">{props.title}</div>
      <p className="mt-2 leading-6">{props.body}</p>
    </div>
  )
}

export function DataList(props: { rows: Array<{ label: string; value: ReactNode }> }) {
  return (
    <div className="app-data-list divide-y divide-slate-200 rounded-[24px] border">
      {props.rows.map((row) => (
        <div key={row.label} className="flex flex-col gap-1 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <span className="app-text-muted">{row.label}</span>
          <span className="app-text-primary font-semibold">{row.value}</span>
        </div>
      ))}
    </div>
  )
}

export function LoadingState(props: { title: string; body: string }) {
  return (
    <div className="app-status app-status-info rounded-[24px] px-4 py-4 text-sm">
      <div className="font-display text-lg">{props.title}</div>
      <p className="mt-2 leading-6">{props.body}</p>
    </div>
  )
}

export function ErrorState(props: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="app-status app-status-danger rounded-[24px] px-4 py-4 text-sm">
      <div className="font-display text-lg">{props.title}</div>
      <p className="mt-2 leading-6">{props.body}</p>
      {props.action ? <div className="mt-3">{props.action}</div> : null}
    </div>
  )
}

export function DraftStatusBanner(props: { restored?: boolean; savedAt?: string | null; onDiscard?: () => void; className?: string }) {
  if (!props.restored && !props.savedAt) {
    return null
  }

  return (
    <div className={clsx('app-status app-status-info flex flex-col gap-3 rounded-[22px] px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between', props.className)}>
      <div>
        <div className="font-semibold text-slate-900">{props.restored ? 'Draft restored' : 'Saved locally'}</div>
        <div className="mt-1">
          {props.savedAt ? `Saved ${new Date(props.savedAt).toLocaleString()}.` : 'Stored on this device.'}
        </div>
      </div>
      {props.onDiscard ? (
        <ActionButton tone="secondary" onClick={props.onDiscard} className="w-full sm:w-auto">
          Discard draft
        </ActionButton>
      ) : null}
    </div>
  )
}

export type ConfirmSheetRequest = {
  title: string
  body: string
  confirmLabel?: string
  cancelLabel?: string
  confirmationValue?: string
  confirmationHint?: string
  isPending?: boolean
  onConfirm: () => void
}

export function ConfirmSheet(props: { request: ConfirmSheetRequest | null; onClose: () => void }) {
  const [typedValue, setTypedValue] = useState('')

  useEffect(() => {
    setTypedValue('')
  }, [props.request?.title, props.request?.confirmationValue])

  if (!props.request) {
    return null
  }

  const needsExactMatch = Boolean(props.request.confirmationValue)
  const canConfirm = !needsExactMatch || typedValue.trim() === props.request.confirmationValue

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 p-3 backdrop-blur sm:items-center">
      <div aria-modal="true" role="dialog" className="app-panel w-full max-w-lg rounded-[28px] border p-5 shadow-halo">
        <div className="font-display text-2xl app-text-primary">{props.request.title}</div>
        <p className="mt-3 text-sm leading-6 app-text-muted">{props.request.body}</p>

        {needsExactMatch ? (
          <div className="mt-4">
            <LabelledInput
              label={props.request.confirmationHint ?? `Type ${props.request.confirmationValue} to confirm`}
              value={typedValue}
              onChange={setTypedValue}
              placeholder={props.request.confirmationValue}
            />
          </div>
        ) : null}

        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <ActionButton tone="secondary" onClick={props.onClose} className="w-full sm:w-auto" disabled={props.request.isPending}>
            {props.request.cancelLabel ?? 'Cancel'}
          </ActionButton>
          <ActionButton
            onClick={() => {
              props.request?.onConfirm()
              props.onClose()
            }}
            className="w-full sm:w-auto"
            disabled={!canConfirm || props.request.isPending}
          >
            {props.request.isPending ? 'Working...' : (props.request.confirmLabel ?? 'Confirm')}
          </ActionButton>
        </div>
      </div>
    </div>
  )
}
