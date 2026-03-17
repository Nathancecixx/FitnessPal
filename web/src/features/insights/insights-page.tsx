import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { CoachNudgePanel, filterCoachNudges } from '../../components/coach-panels'
import { EChart } from '../../components/charts/echart'
import { ActionButton, DataList, DraftStatusBanner, EmptyState, LabelledInput, LabelledTextArea, PageIntro, Panel } from '../../components/ui'
import { api, type AssistantCoachAdvice } from '../../lib/api'
import { useDraftState } from '../../lib/draft-store'
import { invalidateCheckInQueries } from '../../lib/query-invalidations'
import { queryClient } from '../../lib/query-client'
import { useWeightUnit } from '../../lib/user-preferences'
import { convertMassFromKg, formatMass, formatMassRate, getWeightUnitLabel } from '../../lib/weight-units'

const defaultCoachPrompts = [
  'What should I focus on over the next 3 days based on my current logs?',
  'Give me a pre-workout primer before my next session.',
  'How should I adjust calories or training based on my weight trend?',
  'What is the biggest thing holding back progress right now?',
] as const

type CheckInDraft = {
  sleep_hours: string
  readiness_1_5: string
  soreness_1_5: string
  hunger_1_5: string
  note: string
}

function createCheckInDraft() {
  return {
    sleep_hours: '',
    readiness_1_5: '',
    soreness_1_5: '',
    hunger_1_5: '',
    note: '',
  }
}

function formatCoachBody(body: string | null | undefined) {
  return (body ?? '').replaceAll('**', '').trim()
}

function formatCoachTimestamp(value: string | undefined) {
  return value ? new Date(value).toLocaleString() : 'Live snapshot'
}

function formatSimpleMetric(value: string | number | null | undefined, suffix?: string) {
  if (value === null || value === undefined || value === '') {
    return 'n/a'
  }
  if (typeof value === 'number') {
    if (suffix === 'kg/week') {
      return `${value.toFixed(2)} kg/week`
    }
    return suffix ? `${value} ${suffix}` : `${value}`
  }
  return suffix ? `${value} ${suffix}` : value
}

function formatAdherence(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') {
    return 'n/a'
  }
  if (typeof value === 'number') {
    return `${Math.round(value * 100)}%`
  }
  return value
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

function coachSourceLabel(advice: AssistantCoachAdvice | undefined, feedSource: string | undefined, briefProvider: string | null | undefined, briefModel: string | null | undefined) {
  const source = advice?.source ?? feedSource
  const provider = advice?.provider ?? briefProvider
  const model = advice?.model_name ?? briefModel
  const label = source === 'ai' ? 'AI coach' : source === 'deterministic' ? 'Smart fallback' : 'Coach snapshot'
  return [label, provider, model].filter(Boolean).join(' | ')
}

export function CoachPage() {
  const weightUnit = useWeightUnit()
  const weightUnitLabel = getWeightUnitLabel(weightUnit)
  const insightsQuery = useQuery({ queryKey: ['insights-summary'], queryFn: () => api.getInsightSummary(90) })
  const feedQuery = useQuery({ queryKey: ['assistant-feed'], queryFn: api.getAssistantFeed })
  const coachPromptState = useDraftState<string>({ formId: 'coach-prompt', initialValue: defaultCoachPrompts[0], route: '/coach' })
  const coachPrompt = coachPromptState.value
  const setCoachPrompt = coachPromptState.setValue
  const checkInDraftState = useDraftState<CheckInDraft>({ formId: 'coach-check-in', initialValue: createCheckInDraft(), route: '/coach' })
  const checkInDraft = checkInDraftState.value
  const setCheckInDraft = checkInDraftState.setValue

  useEffect(() => {
    const checkIn = feedQuery.data?.feed.today_check_in
    if (!checkIn) {
      setCheckInDraft(createCheckInDraft())
      return
    }
    setCheckInDraft({
      sleep_hours: checkIn.sleep_hours == null ? '' : String(checkIn.sleep_hours),
      readiness_1_5: checkIn.readiness_1_5 == null ? '' : String(checkIn.readiness_1_5),
      soreness_1_5: checkIn.soreness_1_5 == null ? '' : String(checkIn.soreness_1_5),
      hunger_1_5: checkIn.hunger_1_5 == null ? '' : String(checkIn.hunger_1_5),
      note: checkIn.note ?? '',
    })
  }, [feedQuery.data?.feed.today_check_in?.id, feedQuery.data?.feed.today_check_in?.updated_at])

  const refreshFeed = useMutation({
    mutationFn: api.refreshAssistantFeed,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['assistant-feed'] }),
        queryClient.invalidateQueries({ queryKey: ['assistant-brief'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['insights'] }),
        queryClient.invalidateQueries({ queryKey: ['insights-summary'] }),
      ])
    },
  })

  const saveCheckIn = useMutation({
    mutationFn: () => api.updateCoachCheckIn({
      sleep_hours: checkInDraft.sleep_hours ? Number(checkInDraft.sleep_hours) : null,
      readiness_1_5: checkInDraft.readiness_1_5 ? Number(checkInDraft.readiness_1_5) : null,
      soreness_1_5: checkInDraft.soreness_1_5 ? Number(checkInDraft.soreness_1_5) : null,
      hunger_1_5: checkInDraft.hunger_1_5 ? Number(checkInDraft.hunger_1_5) : null,
      note: checkInDraft.note || null,
    }),
    onSuccess: async () => {
      checkInDraftState.meta.clearDraft()
      await invalidateCheckInQueries()
    },
  })

  const askCoach = useMutation({
    mutationFn: (prompt: string) => api.askCoachAdvice(prompt),
  })

  const runCoachPrompt = (prompt: string) => {
    const cleanedPrompt = prompt.trim()
    if (!cleanedPrompt) {
      return
    }
    setCoachPrompt(cleanedPrompt)
    askCoach.mutate(cleanedPrompt)
  }

  const payload = insightsQuery.data?.summary
  const feed = feedQuery.data?.feed
  const brief = feed?.brief
  const advice = askCoach.data?.advice
  const calorieEntries = Object.entries(payload?.nutrition.daily_calories ?? {})
  const coachNudges = filterCoachNudges(feed?.nudges, 'coach')
  const coachPrompts = feed?.quick_prompts.length ? feed.quick_prompts : [...defaultCoachPrompts]
  const checkInError = [checkInDraft.readiness_1_5, checkInDraft.soreness_1_5, checkInDraft.hunger_1_5]
    .some((value) => value && (Number(value) < 1 || Number(value) > 5))
    ? 'Readiness, soreness, and hunger must stay between 1 and 5.'
    : ''

  if (!feed) {
    return (
      <div className="space-y-4">
        <PageIntro
          eyebrow="Coach"
          title="Coach hub"
          description="Loading coach..."
          actions={(
            <ActionButton onClick={() => refreshFeed.mutate()} disabled={refreshFeed.isPending}>
              {refreshFeed.isPending ? 'Refreshing...' : 'Refresh coach'}
            </ActionButton>
          )}
        />
        <EmptyState title="Coach feed loading" body="Your coach view will show up here." />
      </div>
    )
  }

  const coachTitle = advice?.title ?? feed.top_focus.title
  const coachSummary = advice?.summary ?? feed.top_focus.summary
  const coachBody = formatCoachBody(advice?.body_markdown ?? brief?.body_markdown)
  const coachActions = advice?.actions.length ? advice.actions : feed.actions
  const coachWatchouts = advice?.watchouts.length ? advice.watchouts : feed.watchouts
  const coachStats = advice?.stats ?? feed.stats
  const coachRows = [
    { label: 'Avg calories (7d)', value: formatSimpleMetric(coachStats['average_calories_7'] ?? payload?.nutrition.average_calories_7, 'kcal') },
    { label: 'Goal calories', value: formatSimpleMetric(coachStats['goal_calories'] ?? payload?.nutrition.goal_calories, 'kcal') },
    { label: 'Adherence', value: formatAdherence(coachStats['adherence_ratio'] ?? payload?.nutrition.adherence_ratio) },
    { label: 'Today calories', value: formatSimpleMetric(coachStats['today_calories'], 'kcal') },
    { label: 'Today protein', value: formatSimpleMetric(coachStats['today_protein_g'], 'g') },
    { label: 'Protein target', value: formatSimpleMetric(coachStats['protein_target_g'], 'g') },
    { label: 'Weekly volume', value: formatCoachMassStat(coachStats['weekly_volume_kg'] ?? payload?.training.weekly_volume_kg, (value) => formatMass(value, weightUnit, { decimals: 0 })) },
    { label: 'Weight trend', value: formatCoachMassStat(coachStats['weight_trend_kg_per_week'] ?? payload?.body.weight_trend_kg_per_week, (value) => formatMassRate(value, weightUnit)) },
  ]

  return (
    <div className="space-y-4">
      <PageIntro
        eyebrow="Coach"
        title={brief?.persona_name ?? 'FitnessPal Coach'}
        description={brief?.persona_tagline ?? 'Clear next steps, kept simple.'}
        actions={(
          <ActionButton tone="secondary" onClick={() => refreshFeed.mutate()} disabled={refreshFeed.isPending}>
            {refreshFeed.isPending ? 'Refreshing...' : 'Refresh coach'}
          </ActionButton>
        )}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_400px]">
        <Panel
          title={coachTitle}
          subtitle={advice?.focus_area ?? 'Top focus'}
        >
          <div className="space-y-4">
            <div className="overflow-hidden rounded-[28px] bg-[radial-gradient(circle_at_top,_rgba(132,204,22,0.18),_transparent_42%),linear-gradient(140deg,_#020617,_#0f172a_58%,_#1e293b)] p-5 text-canvas">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="max-w-2xl">
                  <div className="text-[11px] uppercase tracking-[0.26em] text-lime-300/80">Top focus</div>
                  <div className="mt-3 font-display text-3xl leading-none">{coachTitle}</div>
                  <div className="mt-3 text-base leading-7 text-slate-200">{coachSummary}</div>
                </div>
                <div className="rounded-[22px] border border-white/10 bg-white/10 px-4 py-3 text-right text-xs text-slate-200">
                  <div>{coachSourceLabel(advice, feed.source, brief?.provider, brief?.model_name)}</div>
                  <div className="mt-2 text-slate-300">{formatCoachTimestamp(advice?.generated_at ?? brief?.updated_at ?? feed.generated_at)}</div>
                </div>
              </div>

              {advice?.question ? (
                <div className="mt-4 rounded-[22px] border border-white/10 bg-white/8 px-4 py-3 text-sm leading-6 text-slate-200">
                  <div className="text-[11px] uppercase tracking-[0.22em] text-lime-300/80">Your ask</div>
                  <div className="mt-2">{advice.question}</div>
                </div>
              ) : null}

              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <div className="rounded-[22px] border border-white/10 bg-white/10 px-4 py-4">
                  <div className="text-[11px] uppercase tracking-[0.22em] text-slate-300">Avg calories</div>
                  <div className="mt-2 font-display text-3xl">{formatSimpleMetric(coachStats['average_calories_7'] ?? payload?.nutrition.average_calories_7, 'kcal')}</div>
                </div>
                <div className="rounded-[22px] border border-white/10 bg-white/10 px-4 py-4">
                  <div className="text-[11px] uppercase tracking-[0.22em] text-slate-300">Weekly volume</div>
                  <div className="mt-2 font-display text-3xl">{formatCoachMassStat(coachStats['weekly_volume_kg'] ?? payload?.training.weekly_volume_kg, (value) => formatMass(value, weightUnit, { decimals: 0 }))}</div>
                </div>
                <div className="rounded-[22px] border border-white/10 bg-white/10 px-4 py-4">
                  <div className="text-[11px] uppercase tracking-[0.22em] text-slate-300">Weight trend</div>
                  <div className="mt-2 font-display text-3xl">{formatCoachMassStat(coachStats['weight_trend_kg_per_week'] ?? payload?.body.weight_trend_kg_per_week, (value) => formatMassRate(value, weightUnit))}</div>
                </div>
              </div>
            </div>

            {coachBody ? (
              <div className="whitespace-pre-line rounded-[24px] bg-slate-100 px-4 py-4 text-sm leading-7 text-slate-700">
                {coachBody}
              </div>
            ) : null}

            {coachActions.length ? (
              <div className="grid gap-3 md:grid-cols-2">
                {coachActions.map((item) => (
                  <div key={item} className="rounded-[24px] bg-white px-4 py-4 text-sm leading-6 text-slate-700 ring-1 ring-slate-200">
                    {item}
                  </div>
                ))}
              </div>
            ) : null}

            {coachWatchouts.length ? (
              <div className="grid gap-3 md:grid-cols-2">
                {coachWatchouts.map((item) => (
                  <div key={item} className="app-status app-status-danger rounded-[24px] px-4 py-4 text-sm leading-6">
                    {item}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel
            title={feed.today_check_in?.is_today ? "Today's check-in" : 'Daily check-in'}
            subtitle="A quick daily read."
          >
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault()
                if (!checkInError) {
                  saveCheckIn.mutate()
                }
              }}
            >
              <DraftStatusBanner restored={checkInDraftState.meta.restored} savedAt={checkInDraftState.meta.savedAt} onDiscard={checkInDraftState.meta.clearDraft} />
              <div className="grid gap-3 sm:grid-cols-2">
                <LabelledInput label="Sleep hours" type="number" step="0.1" value={checkInDraft.sleep_hours} onChange={(value) => setCheckInDraft((current) => ({ ...current, sleep_hours: value }))} placeholder="7.5" />
                <LabelledInput label="Readiness (1-5)" type="number" value={checkInDraft.readiness_1_5} onChange={(value) => setCheckInDraft((current) => ({ ...current, readiness_1_5: value }))} placeholder="4" />
                <LabelledInput label="Soreness (1-5)" type="number" value={checkInDraft.soreness_1_5} onChange={(value) => setCheckInDraft((current) => ({ ...current, soreness_1_5: value }))} placeholder="2" />
                <LabelledInput label="Hunger (1-5)" type="number" value={checkInDraft.hunger_1_5} onChange={(value) => setCheckInDraft((current) => ({ ...current, hunger_1_5: value }))} placeholder="3" />
              </div>
              <LabelledTextArea label="Note" value={checkInDraft.note} onChange={(value) => setCheckInDraft((current) => ({ ...current, note: value }))} rows={3} placeholder="Low sleep, high stress, strong appetite" />
              <div className="flex flex-wrap gap-2">
                <ActionButton type="submit" disabled={saveCheckIn.isPending || Boolean(checkInError)}>{saveCheckIn.isPending ? 'Saving...' : 'Save check-in'}</ActionButton>
                {feed.today_check_in ? (
                  <div className="rounded-full bg-slate-100 px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-600">
                    {feed.today_check_in.is_today ? 'Saved for today' : `Last saved ${new Date(feed.today_check_in.updated_at).toLocaleDateString()}`}
                  </div>
                ) : null}
              </div>
              {checkInError ? <div className="app-status app-status-danger rounded-[22px] px-4 py-3 text-sm">{checkInError}</div> : null}
              {saveCheckIn.isError ? <div className="app-status app-status-danger rounded-[22px] px-4 py-3 text-sm">{saveCheckIn.error.message}</div> : null}
            </form>
          </Panel>

          <Panel
            title="Ask your coach"
            subtitle="Ask anything about your current data."
          >
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault()
                runCoachPrompt(coachPrompt)
              }}
            >
              <DraftStatusBanner restored={coachPromptState.meta.restored} savedAt={coachPromptState.meta.savedAt} onDiscard={coachPromptState.meta.clearDraft} />
              <LabelledTextArea
                label="Prompt"
                value={coachPrompt}
                onChange={setCoachPrompt}
                rows={5}
                placeholder="Example: Weight is drifting down. What should I change?"
              />

              <div className="flex flex-wrap gap-2">
                <ActionButton type="submit" disabled={askCoach.isPending || !coachPrompt.trim()}>
                  {askCoach.isPending ? 'Coaching...' : 'Get tailored advice'}
                </ActionButton>
              </div>

              {askCoach.isError ? (
                <div className="app-status app-status-danger rounded-[22px] px-4 py-3 text-sm">
                  {askCoach.error.message}
                </div>
              ) : null}

              <div className="space-y-2">
                <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Quick prompts</div>
                <div className="grid gap-2">
                  {coachPrompts.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      className="rounded-[22px] border border-slate-200 bg-white px-4 py-3 text-left text-sm leading-6 text-slate-700 transition hover:border-lime-300 hover:bg-lime-50"
                      onClick={() => runCoachPrompt(prompt)}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            </form>
          </Panel>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
        <div className="space-y-4">
          <CoachNudgePanel
            title="Coach nudges"
            subtitle="Extra signals."
            nudges={coachNudges}
            emptyTitle="No coach nudges right now"
            emptyBody="Extra nudges will show up here when needed."
          />

          <Panel title="Nutrition and trend charts" subtitle={`TZ: ${feed.freshness.timezone}`}>
            {payload ? (
              <div className="grid gap-4 lg:grid-cols-2">
                <EChart
                  style={{ height: 280 }}
                  option={{
                    tooltip: { trigger: 'axis' },
                    xAxis: { type: 'category', data: calorieEntries.map(([day]) => day) },
                    yAxis: { type: 'value' },
                    series: [
                      {
                        type: 'line',
                        smooth: true,
                        data: calorieEntries.map(([, calories]) => calories),
                        lineStyle: { color: '#65a30d', width: 3 },
                        areaStyle: { color: '#65a30d', opacity: 0.14 },
                        showSymbol: false,
                      },
                    ],
                  }}
                />
                <EChart
                  style={{ height: 280 }}
                  option={{
                    tooltip: { trigger: 'axis' },
                    xAxis: { type: 'category', data: payload.body.trend_7.map((_, index) => index + 1) },
                    yAxis: { type: 'value' },
                    series: [
                      { name: `7-day (${weightUnitLabel})`, type: 'line', smooth: true, data: payload.body.trend_7.map((value) => convertMassFromKg(value, weightUnit)), lineStyle: { color: '#fb7185' } },
                      { name: `30-day (${weightUnitLabel})`, type: 'line', smooth: true, data: payload.body.trend_30.map((value) => convertMassFromKg(value, weightUnit)), lineStyle: { color: '#0ea5e9' } },
                    ],
                  }}
                />
              </div>
            ) : (
              <EmptyState title="No snapshot yet" body="Log more data to fill the charts." />
            )}
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="Freshness" subtitle="How current the data is.">
            {feed.freshness.stale_signals.length ? (
              <div className="space-y-3">
                {feed.freshness.stale_signals.map((signal) => (
                  <div key={signal} className="app-status app-status-warning rounded-[22px] px-4 py-3 text-sm">
                    {signal}
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="Fresh enough to coach" body="Today’s key inputs are up to date." />
            )}
          </Panel>

          <Panel title="Coach stats" subtitle="Compact view.">
            <DataList rows={coachRows} />
          </Panel>
        </div>
      </div>
    </div>
  )
}

export const InsightsPage = CoachPage
