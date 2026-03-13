import { Link } from '@tanstack/react-router'

import type { CoachNudge } from '../lib/api'
import { EmptyState, Panel } from './ui'

function toneClass(tone: CoachNudge['tone']) {
  if (tone === 'warning') {
    return 'border-amber-300 bg-amber-50 text-amber-950'
  }
  if (tone === 'positive') {
    return 'border-lime-300 bg-lime-50 text-lime-950'
  }
  return 'border-sky-300 bg-sky-50 text-sky-950'
}

export function filterCoachNudges(nudges: CoachNudge[] | undefined, surface: CoachNudge['surface']) {
  return (nudges ?? []).filter((nudge) => nudge.surface === surface)
}

export function CoachNudgePanel(props: {
  title: string
  subtitle: string
  nudges: CoachNudge[]
  emptyTitle: string
  emptyBody: string
}) {
  return (
    <Panel title={props.title} subtitle={props.subtitle}>
      {props.nudges.length ? (
        <div className="grid gap-3">
          {props.nudges.map((nudge) => (
            <div key={nudge.id} className={`rounded-[24px] border px-4 py-4 ${toneClass(nudge.tone)}`}>
              <div className="text-[11px] uppercase tracking-[0.22em] opacity-75">{nudge.tone}</div>
              <div className="mt-2 font-display text-2xl leading-none">{nudge.title}</div>
              <p className="mt-3 text-sm leading-6 opacity-90">{nudge.body}</p>
              {nudge.route && nudge.cta_label ? (
                <div className="mt-4">
                  <Link
                    to={nudge.route}
                    className="inline-flex min-h-[42px] items-center rounded-full bg-slate-950 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-canvas"
                  >
                    {nudge.cta_label}
                  </Link>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState title={props.emptyTitle} body={props.emptyBody} />
      )}
    </Panel>
  )
}
