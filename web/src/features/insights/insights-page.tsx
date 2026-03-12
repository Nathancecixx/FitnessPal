import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { EChart } from '../../components/charts/echart'
import { ActionButton, DataList, EmptyState, LabelledTextArea, PageIntro, Panel } from '../../components/ui'
import { api, type AssistantCoachAdvice } from '../../lib/api'
import { queryClient } from '../../lib/query-client'
import { useWeightUnit } from '../../lib/user-preferences'
import { convertMassFromKg, formatMass, formatMassRate, getWeightUnitLabel } from '../../lib/weight-units'

const coachPrompts = [
  'What should I focus on over the next 3 days based on my current logs?',
  'Give me a coach check-in before my next workout.',
  'How should I adjust calories or training based on my weight trend?',
  'What is the biggest thing holding back progress right now?',
] as const

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

function coachSourceLabel(advice: AssistantCoachAdvice | undefined, briefSource: string | undefined, briefProvider: string | null | undefined, briefModel: string | null | undefined) {
  const source = advice?.source ?? briefSource
  const provider = advice?.provider ?? briefProvider
  const model = advice?.model_name ?? briefModel
  const label = source === 'ai' ? 'AI coach' : source === 'deterministic' ? 'Smart fallback' : 'Coach snapshot'
  return [label, provider, model].filter(Boolean).join(' · ')
}

export function InsightsPage() {
  const weightUnit = useWeightUnit()
  const weightUnitLabel = getWeightUnitLabel(weightUnit)
  const insightsQuery = useQuery({ queryKey: ['insights-summary'], queryFn: () => api.getInsightSummary(90) })
  const briefQuery = useQuery({ queryKey: ['assistant-brief'], queryFn: api.getAssistantBrief, retry: false })
  const [coachPrompt, setCoachPrompt] = useState('What should I focus on over the next 3 days based on my current logs?')

  const recompute = useMutation({
    mutationFn: api.recomputeInsights,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['insights'] }),
        queryClient.invalidateQueries({ queryKey: ['insights-summary'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['assistant-brief'] }),
      ])
    },
  })

  const refreshBrief = useMutation({
    mutationFn: api.refreshAssistantBrief,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['assistant-brief'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['insights-summary'] }),
      ])
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
  const brief = briefQuery.data?.brief
  const advice = askCoach.data?.advice
  const calorieEntries = Object.entries(payload?.nutrition.daily_calories ?? {})

  if (!payload) {
    return (
      <div className="space-y-4">
        <PageIntro
          eyebrow="Coach"
          title={brief?.persona_name ?? 'Coach mode'}
          description={brief?.persona_tagline ?? 'Log meals, workouts, and weigh-ins, then recompute insights to generate your first tailored coach read.'}
          actions={(
            <ActionButton onClick={() => recompute.mutate()} disabled={recompute.isPending}>
              {recompute.isPending ? 'Recomputing...' : 'Recompute insights'}
            </ActionButton>
          )}
        />
        <EmptyState title="No insight snapshot yet" body="Log meals, workouts, and bodyweight entries, then recompute insights to unlock the AI coach view." />
      </div>
    )
  }

  const coachTitle = advice?.title ?? brief?.title ?? 'Coach board'
  const coachSummary = advice?.summary ?? brief?.summary ?? 'Ask your coach for a tailored read based on your latest logs.'
  const coachBody = formatCoachBody(advice?.body_markdown ?? brief?.body_markdown)
  const coachActions = advice?.actions.length ? advice.actions : (brief?.actions.length ? brief.actions : payload.recommendations)
  const coachWatchouts = advice?.watchouts.length ? advice.watchouts : payload.recovery_flags
  const coachStats = advice?.stats ?? brief?.stats ?? {}
  const coachRows = [
    { label: 'Avg calories (7d)', value: formatSimpleMetric(coachStats['average_calories_7'] ?? Math.round(payload.nutrition.average_calories_7), 'kcal') },
    { label: 'Goal calories', value: formatSimpleMetric(coachStats['goal_calories'] ?? payload.nutrition.goal_calories, 'kcal') },
    { label: 'Adherence', value: formatAdherence(coachStats['adherence_ratio'] ?? payload.nutrition.adherence_ratio) },
    { label: 'Weekly volume', value: formatCoachMassStat(coachStats['weekly_volume_kg'] ?? Math.round(payload.training.weekly_volume_kg), (value) => formatMass(value, weightUnit, { decimals: 0 })) },
    { label: 'Sessions (7d)', value: formatSimpleMetric(coachStats['session_count_7'] ?? payload.training.session_count_7) },
    { label: 'PR count', value: formatSimpleMetric(coachStats['pr_count'] ?? payload.training.pr_count) },
    { label: 'Weight trend', value: formatCoachMassStat(coachStats['weight_trend_kg_per_week'] ?? payload.body.weight_trend_kg_per_week, (value) => formatMassRate(value, weightUnit)) },
  ]

  return (
    <div className="space-y-4">
      <PageIntro
        eyebrow="Coach"
        title={brief?.persona_name ?? 'FitnessPal Coach'}
        description={brief?.persona_tagline ?? 'Specialized AI coaching layered on top of your meals, bodyweight trend, training load, and recovery signals.'}
        actions={(
          <>
            <ActionButton tone="secondary" onClick={() => refreshBrief.mutate()} disabled={refreshBrief.isPending}>
              {refreshBrief.isPending ? 'Refreshing brief...' : 'Refresh brief'}
            </ActionButton>
            <ActionButton onClick={() => recompute.mutate()} disabled={recompute.isPending}>
              {recompute.isPending ? 'Recomputing...' : 'Recompute insights'}
            </ActionButton>
          </>
        )}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_420px]">
        <Panel
          title={coachTitle}
          subtitle={advice?.focus_area ?? brief?.persona_tagline ?? 'Tailored coaching grounded in your latest app data.'}
        >
          <div className="space-y-4">
            <div className="overflow-hidden rounded-[28px] bg-[radial-gradient(circle_at_top,_rgba(251,191,36,0.24),_transparent_42%),linear-gradient(140deg,_#020617,_#0f172a_58%,_#1e293b)] p-5 text-canvas">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="max-w-2xl">
                  <div className="text-[11px] uppercase tracking-[0.26em] text-amber-300/75">{advice?.focus_area ?? brief?.persona_name ?? 'Coach read'}</div>
                  <div className="mt-3 font-display text-3xl leading-none">{coachTitle}</div>
                  <div className="mt-3 text-base leading-7 text-slate-200">{coachSummary}</div>
                </div>
                <div className="rounded-[22px] border border-white/10 bg-white/10 px-4 py-3 text-right text-xs text-slate-200">
                  <div>{coachSourceLabel(advice, brief?.source, brief?.provider, brief?.model_name)}</div>
                  <div className="mt-2 text-slate-300">{formatCoachTimestamp(advice?.generated_at ?? brief?.updated_at)}</div>
                </div>
              </div>

              {advice?.question ? (
                <div className="mt-4 rounded-[22px] border border-white/10 bg-white/8 px-4 py-3 text-sm leading-6 text-slate-200">
                  <div className="text-[11px] uppercase tracking-[0.22em] text-amber-300/75">Your ask</div>
                  <div className="mt-2">{advice.question}</div>
                </div>
              ) : null}

              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <div className="rounded-[22px] border border-white/10 bg-white/10 px-4 py-4">
                  <div className="text-[11px] uppercase tracking-[0.22em] text-slate-300">Avg calories</div>
                  <div className="mt-2 font-display text-3xl">{formatSimpleMetric(coachStats['average_calories_7'] ?? Math.round(payload.nutrition.average_calories_7), 'kcal')}</div>
                </div>
                <div className="rounded-[22px] border border-white/10 bg-white/10 px-4 py-4">
                  <div className="text-[11px] uppercase tracking-[0.22em] text-slate-300">Weekly volume</div>
                  <div className="mt-2 font-display text-3xl">{formatCoachMassStat(coachStats['weekly_volume_kg'] ?? Math.round(payload.training.weekly_volume_kg), (value) => formatMass(value, weightUnit, { decimals: 0 }))}</div>
                </div>
                <div className="rounded-[22px] border border-white/10 bg-white/10 px-4 py-4">
                  <div className="text-[11px] uppercase tracking-[0.22em] text-slate-300">Weight trend</div>
                  <div className="mt-2 font-display text-3xl">{formatCoachMassStat(coachStats['weight_trend_kg_per_week'] ?? payload.body.weight_trend_kg_per_week, (value) => formatMassRate(value, weightUnit))}</div>
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

            {advice?.follow_up_prompt ? (
              <button
                type="button"
                className="w-full rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4 text-left text-sm leading-6 text-slate-700 transition hover:border-amber-300 hover:bg-amber-50"
                onClick={() => runCoachPrompt(advice.follow_up_prompt ?? '')}
              >
                <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Coach follow-up</div>
                <div className="mt-2 font-semibold text-slate-950">{advice.follow_up_prompt}</div>
              </button>
            ) : null}
          </div>
        </Panel>

        <Panel
          title="Ask your coach"
          subtitle="Each answer gets your live insight snapshot, recent meals, recent workouts, recent weigh-ins, and a built-in coach system prompt."
        >
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              runCoachPrompt(coachPrompt)
            }}
          >
            <LabelledTextArea
              label="Prompt"
              value={coachPrompt}
              onChange={setCoachPrompt}
              rows={6}
              placeholder="Example: I have an upper session tomorrow and my weight is drifting down. What should I change?"
            />

            <div className="flex flex-wrap gap-2">
              <ActionButton type="submit" disabled={askCoach.isPending || !coachPrompt.trim()}>
                {askCoach.isPending ? 'Coaching...' : 'Get tailored advice'}
              </ActionButton>
              {advice?.follow_up_prompt ? (
                <ActionButton tone="secondary" onClick={() => setCoachPrompt(advice.follow_up_prompt ?? '')} className="w-auto">
                  Use follow-up
                </ActionButton>
              ) : null}
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
                    className="rounded-[22px] border border-slate-200 bg-white px-4 py-3 text-left text-sm leading-6 text-slate-700 transition hover:border-amber-300 hover:bg-amber-50"
                    onClick={() => runCoachPrompt(prompt)}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-[24px] bg-slate-100 p-4">
              <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">What the coach sees</div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="rounded-[20px] bg-white px-4 py-3">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Calories</div>
                  <div className="mt-2 font-display text-2xl text-slate-950">{Math.round(payload.nutrition.average_calories_7)} kcal</div>
                </div>
                <div className="rounded-[20px] bg-white px-4 py-3">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Adherence</div>
                  <div className="mt-2 font-display text-2xl text-slate-950">{formatAdherence(payload.nutrition.adherence_ratio)}</div>
                </div>
                <div className="rounded-[20px] bg-white px-4 py-3">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Volume</div>
                  <div className="mt-2 font-display text-2xl text-slate-950">{formatMass(payload.training.weekly_volume_kg, weightUnit, { decimals: 0 })}</div>
                </div>
                <div className="rounded-[20px] bg-white px-4 py-3">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Weight trend</div>
                  <div className="mt-2 font-display text-2xl text-slate-950">{formatMassRate(payload.body.weight_trend_kg_per_week, weightUnit)}</div>
                </div>
              </div>
            </div>
          </form>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_360px]">
        <div className="space-y-4">
          <Panel title="Nutrition and trend charts" subtitle={`Snapshot generated ${new Date(payload.generated_at).toLocaleString()}`}>
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
                      lineStyle: { color: '#d97706', width: 3 },
                      areaStyle: { color: '#d97706', opacity: 0.14 },
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
                    { name: `30-day (${weightUnitLabel})`, type: 'line', smooth: true, data: payload.body.trend_30.map((value) => convertMassFromKg(value, weightUnit)), lineStyle: { color: '#84cc16' } },
                  ],
                }}
              />
            </div>
          </Panel>

          <Panel title="Coach signals" subtitle="Deterministic recommendations from the insight engine stay visible under the AI layer.">
            <div className="grid gap-3 md:grid-cols-2">
              {payload.recommendations.map((item) => (
                <div key={item} className="rounded-[24px] bg-slate-950 px-4 py-4 text-sm leading-6 text-canvas">
                  {item}
                </div>
              ))}
              {!payload.recommendations.length ? (
                <EmptyState title="No signals yet" body="As soon as the snapshot has enough data, the app will surface deterministic coaching signals here." />
              ) : null}
            </div>
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="Recovery flags" subtitle="Signals that could explain stalled performance, low output, or extra fatigue.">
            {payload.recovery_flags.length ? (
              <div className="space-y-3">
                {payload.recovery_flags.map((flag) => (
                  <div key={flag} className="app-status app-status-danger rounded-[24px] px-4 py-4 text-sm">
                    {flag}
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="No flags raised" body="Current meal adherence, bodyweight, and volume data are not triggering recovery warnings." />
            )}
          </Panel>

          <Panel title="Scoreboard" subtitle="Compact numeric summary for the current coaching window.">
            <DataList rows={coachRows} />
          </Panel>
        </div>
      </div>
    </div>
  )
}
