import { clsx } from 'clsx'
import type { PropsWithChildren, ReactNode } from 'react'

export function PageIntro(props: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return (
    <div className="rounded-[32px] border border-white/10 bg-slate-950/75 p-6 shadow-halo backdrop-blur md:p-8">
      <div className="mb-4 text-xs font-semibold uppercase tracking-[0.3em] text-amber-300/80">{props.eyebrow}</div>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="font-display text-3xl text-canvas md:text-5xl">{props.title}</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300 md:text-base">{props.description}</p>
        </div>
        {props.actions ? <div className="flex flex-wrap gap-3">{props.actions}</div> : null}
      </div>
    </div>
  )
}

export function Panel(props: PropsWithChildren<{ title?: string; subtitle?: string; className?: string; action?: ReactNode }>) {
  return (
    <section className={clsx('rounded-[28px] border border-slate-900/10 bg-white/80 p-5 shadow-halo backdrop-blur', props.className)}>
      {(props.title || props.action) ? (
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            {props.title ? <h2 className="font-display text-xl text-slate-950">{props.title}</h2> : null}
            {props.subtitle ? <p className="mt-1 text-sm text-slate-500">{props.subtitle}</p> : null}
          </div>
          {props.action}
        </div>
      ) : null}
      {props.children}
    </section>
  )
}

export function ActionButton(props: PropsWithChildren<{ onClick?: () => void; type?: 'button' | 'submit'; tone?: 'primary' | 'secondary'; className?: string }>) {
  const palette = props.tone === 'secondary'
    ? 'bg-white text-slate-900 ring-1 ring-slate-200 hover:bg-slate-50'
    : 'bg-amber-400 text-slate-950 hover:bg-amber-300'
  return (
    <button type={props.type ?? 'button'} onClick={props.onClick} className={clsx('inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-semibold transition', palette, props.className)}>
      {props.children}
    </button>
  )
}

export function LabelledInput(props: { label: string; type?: string; value: string | number; onChange: (value: string) => void; placeholder?: string; step?: string }) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{props.label}</span>
      <input
        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-amber-400"
        type={props.type ?? 'text'}
        value={props.value}
        step={props.step}
        onChange={(event) => props.onChange(event.target.value)}
        placeholder={props.placeholder}
      />
    </label>
  )
}

export function EmptyState(props: { title: string; body: string }) {
  return (
    <div className="rounded-[24px] border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
      <div className="font-display text-lg text-slate-800">{props.title}</div>
      <p className="mt-2 leading-6">{props.body}</p>
    </div>
  )
}

export function DataList(props: { rows: Array<{ label: string; value: ReactNode }> }) {
  return (
    <div className="divide-y divide-slate-200 rounded-[24px] border border-slate-200 bg-white">
      {props.rows.map((row) => (
        <div key={row.label} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
          <span className="text-slate-500">{row.label}</span>
          <span className="font-semibold text-slate-950">{row.value}</span>
        </div>
      ))}
    </div>
  )
}
