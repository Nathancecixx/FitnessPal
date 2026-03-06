import { useMutation, useQuery } from '@tanstack/react-query'

import { EChart } from '../../components/charts/echart'
import { ActionButton, DataList, EmptyState, PageIntro, Panel } from '../../components/ui'
import { api } from '../../lib/api'
import { queryClient } from '../../lib/query-client'

function formatCoachBody(body: string | null | undefined) {
  return (body ?? '').replaceAll('**', '').trim()
}

export function InsightsPage() {
  const insightsQuery = useQuery({ queryKey: ['insights'], queryFn: api.getInsights })
  const briefQuery = useQuery({ queryKey: ['assistant-brief'], queryFn: api.getAssistantBrief, retry: false })
  const recompute = useMutation({
    mutationFn: api.recomputeInsights,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['insights'] }),
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
      ])
    },
  })

  const snapshot = insightsQuery.data?.snapshot
  const payload = snapshot?.payload
  const brief = briefQuery.data?.brief
  const calorieEntries = Object.entries(payload?.nutrition.daily_calories ?? {})

  return (
    <div className="space-y-4">
      <PageIntro
        eyebrow="Coach"
        title={brief?.persona_name ?? 'Coach-mode without auto-programming'}
        description={brief?.persona_tagline ?? 'The app synthesizes nutrition adherence, bodyweight trajectory, training volume, and recovery flags into a short list of actions while keeping the user fully in control of what gets logged or changed.'}
        actions={(
          <>
            <ActionButton tone="secondary" onClick={() => refreshBrief.mutate()} disabled={refreshBrief.isPending || !payload}>
              {refreshBrief.isPending ? 'Refreshing brief...' : 'Refresh brief'}
            </ActionButton>
            <ActionButton onClick={() => recompute.mutate()} disabled={recompute.isPending}>
              {recompute.isPending ? 'Recomputing...' : 'Recompute insights'}
            </ActionButton>
          </>
        )}
      />

      {!payload ? (
        <EmptyState title="No insight snapshot yet" body="Log meals, workouts, and bodyweight entries, then recompute insights to generate your first local coaching summary." />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_360px]">
          <div className="space-y-4">
            <Panel title={brief?.title ?? 'Daily brief'} subtitle={brief ? `Generated ${new Date(brief.updated_at).toLocaleString()}` : 'Brandable assistant summary grounded in your latest data.'}>
              {brief ? (
                <div className="space-y-4">
                  <div className="rounded-[24px] bg-slate-950 px-4 py-4 text-canvas">
                    <div className="text-[11px] uppercase tracking-[0.24em] text-amber-300/75">{brief.persona_name}</div>
                    <div className="mt-3 font-display text-2xl">{brief.summary}</div>
                  </div>
                  {brief.body_markdown ? (
                    <div className="whitespace-pre-line rounded-[24px] bg-slate-100 px-4 py-4 text-sm leading-6 text-slate-700">
                      {formatCoachBody(brief.body_markdown)}
                    </div>
                  ) : null}
                  <div className="grid gap-3 md:grid-cols-2">
                    {brief.actions.map((item) => (
                      <div key={item} className="rounded-[24px] bg-white px-4 py-4 text-sm leading-6 text-slate-700 ring-1 ring-slate-200">{item}</div>
                    ))}
                  </div>
                </div>
              ) : (
                <EmptyState title="Coach brief not ready" body="Recompute insights or refresh the brief after connecting an AI backend to generate a branded daily summary." />
              )}
            </Panel>

            <Panel title="Recommendations" subtitle={`Snapshot generated ${new Date(snapshot.created_at).toLocaleString()}`}>
              <div className="grid gap-3 md:grid-cols-2">
                {payload.recommendations.map((item) => (
                  <div key={item} className="rounded-[24px] bg-slate-950 px-4 py-4 text-sm leading-6 text-canvas">{item}</div>
                ))}
              </div>
            </Panel>

            <Panel title="Nutrition and trend charts" subtitle="Daily calorie totals and weight smoothing from local history.">
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
                      { type: 'line', smooth: true, data: payload.body.trend_7, lineStyle: { color: '#fb7185' } },
                      { type: 'line', smooth: true, data: payload.body.trend_30, lineStyle: { color: '#84cc16' } },
                    ],
                  }}
                />
              </div>
            </Panel>
          </div>

          <div className="space-y-4">
            <Panel title="Recovery flags" subtitle="Signals that could explain stalled performance or fatigue.">
              {payload.recovery_flags.length ? (
                <div className="space-y-3">
                  {payload.recovery_flags.map((flag) => <div key={flag} className="rounded-[24px] bg-rose-50 px-4 py-4 text-sm text-rose-900">{flag}</div>)}
                </div>
              ) : (
                <EmptyState title="No flags raised" body="Current meal adherence, bodyweight, and volume data are not triggering recovery warnings." />
              )}
            </Panel>

            <Panel title="Scoreboard" subtitle="Compact numeric summary for the last window.">
              <DataList rows={[
                { label: 'Avg calories (7d)', value: brief?.stats.average_calories_7 ?? Math.round(payload.nutrition.average_calories_7) },
                { label: 'Goal calories', value: payload.nutrition.goal_calories ?? 'No goal' },
                { label: 'Adherence ratio', value: payload.nutrition.adherence_ratio ?? 'n/a' },
                { label: 'Weekly volume', value: brief?.stats.weekly_volume_kg ?? `${Math.round(payload.training.weekly_volume_kg)} kg` },
                { label: 'Volume delta', value: `${Math.round(payload.training.volume_delta_kg)} kg` },
                { label: 'PR count', value: brief?.stats.pr_count ?? payload.training.pr_count },
                { label: 'Weight trend', value: brief?.stats.weight_trend_kg_per_week ?? `${payload.body.weight_trend_kg_per_week.toFixed(2)} kg/week` },
              ]} />
            </Panel>
          </div>
        </div>
      )}
    </div>
  )
}
