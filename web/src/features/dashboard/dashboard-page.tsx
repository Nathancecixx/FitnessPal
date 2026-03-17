import { Link } from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { StatCard, TinyLineChart } from '../../components/cards/stat-card'
import { ActionButton, DraftStatusBanner, EmptyState, ErrorState, LabelledTextArea, LoadingState, PageIntro, Panel } from '../../components/ui'
import { api, type AssistantDraft } from '../../lib/api'
import { useDraftState } from '../../lib/draft-store'
import { queryClient } from '../../lib/query-client'
import { useWeightUnit } from '../../lib/user-preferences'
import { convertMassFromKg, formatMass, formatMassRate, getWeightUnitLabel, type WeightUnit } from '../../lib/weight-units'

const quickActions = [
  { to: '/nutrition', title: 'Log food', subtitle: 'Meals and photos', accent: 'amber' },
  { to: '/training', title: 'Log workout', subtitle: 'Sets and lifts', accent: 'sky' },
  { to: '/weight', title: 'Log weight', subtitle: 'Fast trend check', accent: 'rose' },
  { to: '/templates', title: 'Use repeats', subtitle: 'Saved meals and lifts', accent: 'lime' },
] as const

function formatCoachBody(body: string | null | undefined) {
  return (body ?? '').replaceAll('**', '').trim()
}

function formatCoachMassStat(value: string | number | null | undefined, formatter: (next: number) => string) {
  if (value === null || value === undefined || value === '') {
    return 'n/a'
  }
  if (typeof value === 'number') {
    return formatter(value)
  }
  return value
}

function buildDefaultAssistantNote(weightUnit: WeightUnit) {
  return weightUnit === 'lbs'
    ? 'Weighed 181.7 lbs this morning and ate lunch for 650 kcal with 45P 60C 20F'
    : 'Weighed 82.4 kg this morning and ate lunch for 650 kcal with 45P 60C 20F'
}

export function DashboardPage() {
  const weightUnit = useWeightUnit()
  const weightUnitLabel = getWeightUnitLabel(weightUnit)
  const dashboardQuery = useQuery({ queryKey: ['dashboard'], queryFn: api.getDashboard })
  const insightsQuery = useQuery({ queryKey: ['insights-summary'], queryFn: () => api.getInsightSummary(90) })
  const feedQuery = useQuery({ queryKey: ['assistant-feed'], queryFn: api.getAssistantFeed, retry: false })
  const exercisesQuery = useQuery({ queryKey: ['exercises'], queryFn: api.listExercises })
  const assistantDraftState = useDraftState({ formId: 'dashboard-assistant-note', initialValue: buildDefaultAssistantNote(weightUnit), route: '/' })
  const assistantNote = assistantDraftState.value
  const setAssistantNote = assistantDraftState.setValue
  const [assistantResult, setAssistantResult] = useState<Awaited<ReturnType<typeof api.parseAssistantNote>> | null>(null)

  useEffect(() => {
    const defaultNotes = new Set([buildDefaultAssistantNote('kg'), buildDefaultAssistantNote('lbs')])
    setAssistantNote((current) => defaultNotes.has(current) ? buildDefaultAssistantNote(weightUnit) : current)
  }, [setAssistantNote, weightUnit])

  const cards = (dashboardQuery.data?.cards ?? []).map((card) => {
    if (card.key === 'weight-trend') {
      return {
        ...card,
        value: typeof card.value === 'number' ? formatMass(card.value, weightUnit) : card.value,
        detail: typeof card.trend === 'number' ? formatMassRate(card.trend, weightUnit, { signed: true }) : card.detail,
      }
    }

    if (card.key === 'last-workout-volume') {
      return {
        ...card,
        value: typeof card.value === 'number' ? formatMass(card.value, weightUnit, { decimals: 0 }) : card.value,
      }
    }

    return card
  })

  const insights = insightsQuery.data?.summary
  const feed = feedQuery.data?.feed
  const brief = feed?.brief
  const calorieSeries = Object.values(insights?.nutrition.daily_calories ?? {}).slice(-7)
  const weightSeries = (insights?.body.trend_7 ?? []).map((value) => convertMassFromKg(value, weightUnit))
  const assistantNoteError = assistantNote.trim() ? '' : 'Add a quick note before drafting actions.'
  const todayStatusCards = feed ? [
    { label: 'Food', complete: feed.freshness.meals_logged_today, route: '/nutrition', cta: 'Log food', detail: feed.freshness.meals_logged_today ? 'Meal logging is fresh today.' : 'No meals logged yet today.' },
    { label: 'Weight', complete: feed.freshness.weight_logged_today, route: '/weight', cta: 'Log weight', detail: feed.freshness.weight_logged_today ? 'Today already has a weigh-in.' : 'Today still needs a weigh-in.' },
    { label: 'Check-in', complete: feed.freshness.check_in_completed_today, route: '/coach', cta: 'Save check-in', detail: feed.freshness.check_in_completed_today ? 'Coach has today’s recovery context.' : 'Coach check-in is still missing.' },
    { label: 'Workout', complete: feed.freshness.workout_logged_last_72h, route: '/training', cta: 'Log workout', detail: feed.freshness.workout_logged_last_72h ? 'Training activity is recent enough for coaching.' : 'No workout in the last 72 hours.' },
  ] : []

  const parseAssistant = useMutation({
    mutationFn: () => api.parseAssistantNote(assistantNote),
    onSuccess: (result) => setAssistantResult(result),
  })

  const refreshFeed = useMutation({
    mutationFn: api.refreshAssistantFeed,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['assistant-feed'] }),
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
      assistantDraftState.meta.clearDraft()
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
        queryClient.invalidateQueries({ queryKey: ['assistant-feed'] }),
        queryClient.invalidateQueries({ queryKey: ['assistant-brief'] }),
      ])
    },
  })

  return (
    <div className="space-y-4">
      <PageIntro
        eyebrow="Today"
        title="Quick check-in"
        description="Log food, training, weight, and check-ins from one place."
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

      <Panel title="Today status" subtitle="What still needs logging.">
        {feedQuery.isLoading ? (
          <LoadingState title="Checking today’s status" body="Loading your latest logs." />
        ) : feedQuery.isError ? (
          <ErrorState title="Could not load today’s status" body={feedQuery.error.message} action={<ActionButton onClick={() => feedQuery.refetch()} className="w-auto">Retry</ActionButton>} />
        ) : (
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {todayStatusCards.map((item) => (
                <div key={item.label} className={`rounded-[24px] border px-4 py-4 ${item.complete ? 'bg-emerald-50 border-emerald-100' : 'bg-white border-slate-200'}`}>
                  <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">{item.label}</div>
                  <div className="mt-2 font-display text-2xl text-slate-950">{item.complete ? 'Ready' : 'Needs input'}</div>
                  <div className="mt-2 text-sm leading-6 text-slate-600">{item.detail}</div>
                  {!item.complete ? (
                    <Link to={item.route} className="mt-4 inline-flex min-h-[42px] items-center rounded-full bg-slate-950 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-canvas">
                      {item.cta}
                    </Link>
                  ) : null}
                </div>
              ))}
            </div>
            {feed?.freshness.stale_signals.length ? (
              <div className="space-y-2">
                {feed.freshness.stale_signals.map((signal) => (
                  <div key={signal} className="app-status app-status-warning rounded-[22px] px-4 py-3 text-sm">
                    {signal}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.8fr)]">
        <div className="space-y-4">
          {dashboardQuery.isLoading ? (
            <LoadingState title="Loading dashboard cards" body="Loading your latest summary." />
          ) : dashboardQuery.isError ? (
            <ErrorState title="Could not load dashboard cards" body={dashboardQuery.error.message} action={<ActionButton onClick={() => dashboardQuery.refetch()} className="w-auto">Retry</ActionButton>} />
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {cards.map((card) => <StatCard key={card.key} card={card} />)}
              </div>
              {cards.length === 0 ? <EmptyState title="No dashboard data yet" body="Log a meal, workout, or weigh-in to get started." /> : null}
            </>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <TinyLineChart title="7-day calories" points={calorieSeries.length ? calorieSeries : [0]} color="#d97706" />
            <TinyLineChart title={`7-day weight trend (${weightUnitLabel})`} points={weightSeries.length ? weightSeries : [0]} color="#fb7185" />
          </div>

          <Panel title="Assistant quick capture" subtitle="Turn a quick note into drafts.">
            <div className="space-y-3">
              <DraftStatusBanner restored={assistantDraftState.meta.restored} savedAt={assistantDraftState.meta.savedAt} onDiscard={assistantDraftState.meta.clearDraft} />
              <LabelledTextArea
                label="Natural-language note"
                value={assistantNote}
                onChange={setAssistantNote}
                rows={4}
                error={assistantNoteError || undefined}
                placeholder={weightUnit === 'lbs'
                  ? 'Ate dinner for 720 kcal with 55P 70C 18F, and weighed 181.7 lbs this morning'
                  : 'Ate dinner for 720 kcal with 55P 70C 18F, and weighed 82.4 kg this morning'}
              />
              <div className="flex flex-wrap gap-2">
                <ActionButton onClick={() => parseAssistant.mutate()} disabled={parseAssistant.isPending || Boolean(assistantNoteError)}>
                  {parseAssistant.isPending ? 'Parsing...' : 'Draft actions'}
                </ActionButton>
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
          title={feed?.top_focus.title ?? 'Coach preview'}
          subtitle={brief ? `${brief.persona_name} on deck.` : 'Your next move.'}
          action={(
            <ActionButton tone="secondary" className="w-auto" onClick={() => refreshFeed.mutate()} disabled={refreshFeed.isPending || !insights}>
              {refreshFeed.isPending ? 'Refreshing...' : 'Refresh coach'}
            </ActionButton>
          )}
        >
          {feedQuery.isLoading ? (
            <LoadingState title="Loading coach preview" body="Loading the latest read." />
          ) : feedQuery.isError ? (
            <ErrorState title="Coach preview unavailable" body={feedQuery.error.message} action={<ActionButton onClick={() => feedQuery.refetch()} className="w-auto">Retry</ActionButton>} />
          ) : (
            <div className="space-y-3">
              {feed ? (
                <div className="rounded-[24px] bg-slate-950 px-4 py-4 text-canvas">
                  <div className="text-[11px] uppercase tracking-[0.24em] text-lime-300/75">Top focus</div>
                  <div className="mt-3 font-display text-2xl">{feed.top_focus.title}</div>
                  <div className="mt-2 text-sm leading-6 text-slate-300">{feed.top_focus.summary}</div>
                  <div className="mt-4">
                    <Link
                      to={feed.top_focus.route}
                      className="inline-flex min-h-[42px] items-center rounded-full bg-lime px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-950"
                    >
                      {feed.top_focus.cta_label}
                    </Link>
                  </div>
                </div>
              ) : null}
              {brief?.body_markdown ? (
                <div className="whitespace-pre-line rounded-[20px] bg-slate-100 px-4 py-4 text-sm leading-6 text-slate-700">
                  {formatCoachBody(brief.body_markdown)}
                </div>
              ) : null}
              {(feed?.actions?.length ? feed.actions : (insights?.recommendations ?? []).slice(0, 4)).slice(0, 2).map((note) => (
                <div key={note} className="rounded-[20px] bg-slate-950 px-4 py-3 text-sm leading-6 text-canvas">
                  {note}
                </div>
              ))}
              {feed?.watchouts?.length ? (
                <div className="app-status app-status-warning rounded-[20px] px-4 py-4 text-sm leading-6">
                  {feed.watchouts[0]}
                </div>
              ) : null}
              {refreshFeed.isError ? <div className="app-status app-status-danger rounded-2xl px-4 py-3 text-sm">{refreshFeed.error.message}</div> : null}
              {!feed && !insights?.recommendations?.length ? (
                <EmptyState title="No recommendations yet" body="More guidance will show up as you log." />
              ) : null}
            </div>
          )}

          <div className="mt-5 grid gap-3 rounded-[24px] bg-slate-100 p-4 sm:grid-cols-3">
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Calories</div>
              <div className="mt-2 font-display text-2xl">{feed?.stats.average_calories_7 ?? Math.round(insights?.nutrition.average_calories_7 ?? 0)}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Weekly volume</div>
              <div className="mt-2 font-display text-2xl">{formatCoachMassStat(feed?.stats.weekly_volume_kg ?? Math.round(insights?.training.weekly_volume_kg ?? 0), (value) => formatMass(value, weightUnit, { decimals: 0 }))}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Weight trend</div>
              <div className="mt-2 font-display text-2xl">{formatCoachMassStat(feed?.stats.weight_trend_kg_per_week ?? insights?.body.weight_trend_kg_per_week, (value) => formatMassRate(value, weightUnit))}</div>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  )
}
