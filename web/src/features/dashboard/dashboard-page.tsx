import { Link } from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { StatCard, TinyLineChart } from '../../components/cards/stat-card'
import { ActionButton, EmptyState, LabelledTextArea, PageIntro, Panel } from '../../components/ui'
import { api, type AssistantDraft } from '../../lib/api'
import { queryClient } from '../../lib/query-client'

const quickActions = [
  { to: '/nutrition', title: 'Log food', subtitle: 'Meal, photo, recipe, or template', accent: 'amber' },
  { to: '/training', title: 'Log workout', subtitle: 'Sets first, details second', accent: 'sky' },
  { to: '/weight', title: 'Log weight', subtitle: 'Fast weigh-in with optional extras', accent: 'rose' },
  { to: '/templates', title: 'Use repeats', subtitle: 'Meals and sessions you do often', accent: 'lime' },
] as const

function formatCoachBody(body: string | null | undefined) {
  return (body ?? '').replaceAll('**', '').trim()
}

export function DashboardPage() {
  const dashboardQuery = useQuery({ queryKey: ['dashboard'], queryFn: api.getDashboard })
  const insightsQuery = useQuery({ queryKey: ['insights-summary'], queryFn: () => api.getInsightSummary(90) })
  const briefQuery = useQuery({ queryKey: ['assistant-brief'], queryFn: api.getAssistantBrief, retry: false })
  const exercisesQuery = useQuery({ queryKey: ['exercises'], queryFn: api.listExercises })
  const [assistantNote, setAssistantNote] = useState('Weighed 82.4 kg this morning and ate lunch for 650 kcal with 45P 60C 20F')
  const [assistantResult, setAssistantResult] = useState<Awaited<ReturnType<typeof api.parseAssistantNote>> | null>(null)

  const cards = dashboardQuery.data?.cards ?? []
  const insights = insightsQuery.data?.summary
  const brief = briefQuery.data?.brief
  const calorieSeries = Object.values(insights?.nutrition.daily_calories ?? {}).slice(-7)
  const weightSeries = insights?.body.trend_7 ?? []

  const parseAssistant = useMutation({
    mutationFn: () => api.parseAssistantNote(assistantNote),
    onSuccess: (result) => setAssistantResult(result),
  })

  const refreshBrief = useMutation({
    mutationFn: api.refreshAssistantBrief,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['assistant-brief'] }),
        queryClient.invalidateQueries({ queryKey: ['insights'] }),
        queryClient.invalidateQueries({ queryKey: ['insights-summary'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      ])
    },
  })

  const applyAssistantDraft = useMutation({
    mutationFn: async (draft: AssistantDraft) => {
      if (draft.kind === 'meal_entry') {
        return api.createMeal(draft.payload)
      }
      if (draft.kind === 'weight_entry') {
        return api.createWeightEntry(draft.payload)
      }

      const existingExercises = exercisesQuery.data?.items ?? []
      const knownExerciseIds = new Map(existingExercises.map((exercise) => [exercise.name.trim().toLowerCase(), exercise.id]))
      const sets = []
      for (const entry of draft.payload.sets) {
        let exerciseId = entry.exercise_id
        const label = (entry.exercise_label ?? draft.payload.exercise_name ?? '').trim()
        if (!exerciseId && label) {
          const knownId = knownExerciseIds.get(label.toLowerCase())
          if (knownId) {
            exerciseId = knownId
          } else {
            const created = await api.createExercise({
              name: label,
              rep_target_min: Math.max(entry.reps - 2, 1),
              rep_target_max: entry.reps,
              load_increment: 2.5,
            })
            exerciseId = created.id
            knownExerciseIds.set(label.toLowerCase(), created.id)
          }
        }
        if (!exerciseId) {
          throw new Error('Workout draft needs an exercise name before it can be applied.')
        }
        sets.push({
          exercise_id: exerciseId,
          set_index: entry.set_index,
          reps: entry.reps,
          load_kg: entry.load_kg,
          rir: entry.rir ?? null,
        })
      }
      return api.createWorkoutSession({ notes: draft.payload.notes, sets })
    },
    onSuccess: async (_, draft) => {
      setAssistantResult((current) => current
        ? { ...current, drafts: current.drafts.filter((item) => item !== draft) }
        : current)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['insights'] }),
        queryClient.invalidateQueries({ queryKey: ['insights-summary'] }),
        queryClient.invalidateQueries({ queryKey: ['meals'] }),
        queryClient.invalidateQueries({ queryKey: ['weight-entries'] }),
        queryClient.invalidateQueries({ queryKey: ['weight-trends'] }),
        queryClient.invalidateQueries({ queryKey: ['workout-sessions'] }),
        queryClient.invalidateQueries({ queryKey: ['exercises'] }),
        queryClient.invalidateQueries({ queryKey: ['assistant-brief'] }),
      ])
    },
  })

  return (
    <div className="space-y-4">
      <PageIntro
        eyebrow="Today"
        title="Quick check-in"
        description="Make the common stuff frictionless: log food, add sets, check your weight trend, and only open the deeper builders when you need them."
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {quickActions.map((action) => (
          <Link
            key={action.to}
            to={action.to}
            className={`dashboard-quick-action dashboard-accent-${action.accent} rounded-[24px] border border-slate-200 p-4 shadow-halo`}
          >
            <div className="dashboard-quick-action-eyebrow text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-600">Quick action</div>
            <div className="dashboard-quick-action-title mt-3 font-display text-2xl text-slate-950">{action.title}</div>
            <p className="dashboard-quick-action-copy mt-2 text-sm leading-6 text-slate-700">{action.subtitle}</p>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.8fr)]">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {cards.map((card) => <StatCard key={card.key} card={card} />)}
          </div>
          {cards.length === 0 ? <EmptyState title="No dashboard data yet" body="Log your first meal, workout, or weigh-in to populate the live summary cards." /> : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <TinyLineChart title="7-day calories" points={calorieSeries.length ? calorieSeries : [0]} color="#d97706" />
            <TinyLineChart title="7-day weight trend" points={weightSeries.length ? weightSeries : [0]} color="#fb7185" />
          </div>

          <Panel title="Assistant quick capture" subtitle="Turn a free-form note into reviewable drafts before anything gets written.">
            <div className="space-y-3">
              <LabelledTextArea
                label="Natural-language note"
                value={assistantNote}
                onChange={setAssistantNote}
                rows={4}
                placeholder="Ate dinner for 720 kcal with 55P 70C 18F, and weighed 82.4 kg this morning"
              />
              <div className="flex flex-wrap gap-2">
                <ActionButton onClick={() => parseAssistant.mutate()}>{parseAssistant.isPending ? 'Parsing...' : 'Draft actions'}</ActionButton>
              </div>
              {parseAssistant.isError ? <div className="app-status app-status-danger rounded-2xl px-4 py-3 text-sm">{parseAssistant.error.message}</div> : null}
              {assistantResult?.warnings?.length ? (
                <div className="app-status app-status-warning space-y-2 rounded-[22px] p-4 text-sm">
                  {assistantResult.warnings.map((warning) => <div key={warning}>{warning}</div>)}
                </div>
              ) : null}
              {assistantResult?.drafts?.length ? (
                <div className="space-y-3">
                  {assistantResult.drafts.map((draft, index) => (
                    <div key={`${draft.kind}-${index}`} className="rounded-[22px] border border-slate-200 bg-white p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-xs uppercase tracking-[0.2em] text-slate-500">{draft.kind.replace('_', ' ')}</div>
                          <div className="mt-2 font-semibold text-slate-950">{draft.summary}</div>
                        </div>
                        <ActionButton onClick={() => applyAssistantDraft.mutate(draft)} className="w-auto">
                          {applyAssistantDraft.isPending ? 'Applying...' : 'Apply'}
                        </ActionButton>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </Panel>
        </div>

        <Panel
          title={brief?.title ?? 'Coach feed'}
          subtitle={brief ? `${brief.persona_name} keeps the next useful move visible.` : 'Keep the next useful action visible without turning the app into homework.'}
          action={(
            <ActionButton tone="secondary" className="w-auto" onClick={() => refreshBrief.mutate()} disabled={refreshBrief.isPending || !insights}>
              {refreshBrief.isPending ? 'Refreshing...' : 'Refresh brief'}
            </ActionButton>
          )}
        >
          <div className="space-y-3">
            {brief ? (
              <div className="rounded-[24px] bg-slate-950 px-4 py-4 text-canvas">
                <div className="text-[11px] uppercase tracking-[0.24em] text-amber-300/75">{brief.persona_name}</div>
                <div className="mt-3 font-display text-2xl">{brief.summary}</div>
                <div className="mt-2 text-sm leading-6 text-slate-300">{brief.persona_tagline}</div>
              </div>
            ) : null}
            {brief?.body_markdown ? (
              <div className="whitespace-pre-line rounded-[20px] bg-slate-100 px-4 py-4 text-sm leading-6 text-slate-700">
                {formatCoachBody(brief.body_markdown)}
              </div>
            ) : null}
            {(brief?.actions?.length ? brief.actions : (insights?.recommendations ?? []).slice(0, 4)).map((note) => (
              <div key={note} className="rounded-[20px] bg-slate-950 px-4 py-3 text-sm leading-6 text-canvas">
                {note}
              </div>
            ))}
            {refreshBrief.isError ? <div className="app-status app-status-danger rounded-2xl px-4 py-3 text-sm">{refreshBrief.error.message}</div> : null}
            {!brief && !insights?.recommendations?.length ? (
              <EmptyState title="No recommendations yet" body="As soon as the app has enough meals, workouts, and weigh-ins it will start surfacing a branded coach brief here." />
            ) : null}
          </div>

          <div className="mt-5 grid gap-3 rounded-[24px] bg-slate-100 p-4 sm:grid-cols-3">
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Calories</div>
              <div className="mt-2 font-display text-2xl">{brief?.stats.average_calories_7 ?? Math.round(insights?.nutrition.average_calories_7 ?? 0)}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Weekly volume</div>
              <div className="mt-2 font-display text-2xl">{brief?.stats.weekly_volume_kg ?? Math.round(insights?.training.weekly_volume_kg ?? 0)}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Weight trend</div>
              <div className="mt-2 font-display text-2xl">{brief?.stats.weight_trend_kg_per_week ?? (insights?.body.weight_trend_kg_per_week?.toFixed(2) ?? '0.00')}</div>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  )
}
