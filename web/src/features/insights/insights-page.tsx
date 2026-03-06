import { useMutation, useQuery } from '@tanstack/react-query'

import { EChart } from '../../components/charts/echart'
import { ActionButton, DataList, EmptyState, PageIntro, Panel } from '../../components/ui'
import { api } from '../../lib/api'
import { queryClient } from '../../lib/query-client'

export function InsightsPage() {
  const insightsQuery = useQuery({ queryKey: ['insights'], queryFn: api.getInsights })
  const recompute = useMutation({
    mutationFn: api.recomputeInsights,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['insights'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      ])
    },
  })

  const snapshot = insightsQuery.data?.snapshot
  const payload = snapshot?.payload
  const calorieEntries = Object.entries(payload?.nutrition.daily_calories ?? {})

  return (
    <div className="space-y-4">
      <PageIntro
        eyebrow="Insights"
        title="Coach-mode without auto-programming"
        description="The app synthesizes nutrition adherence, bodyweight trajectory, training volume, and recovery flags into a short list of actions while keeping the user fully in control of what gets logged or changed."
        actions={<ActionButton onClick={() => recompute.mutate()}>Recompute insights</ActionButton>}
      />

      {!payload ? (
        <EmptyState title="No insight snapshot yet" body="Log meals, workouts, and bodyweight entries, then recompute insights to generate your first local coaching summary." />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_360px]">
          <div className="space-y-4">
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
                { label: 'Avg calories (7d)', value: Math.round(payload.nutrition.average_calories_7) },
                { label: 'Goal calories', value: payload.nutrition.goal_calories ?? 'No goal' },
                { label: 'Adherence ratio', value: payload.nutrition.adherence_ratio ?? 'n/a' },
                { label: 'Weekly volume', value: `${Math.round(payload.training.weekly_volume_kg)} kg` },
                { label: 'Volume delta', value: `${Math.round(payload.training.volume_delta_kg)} kg` },
                { label: 'PR count', value: payload.training.pr_count },
                { label: 'Weight trend', value: `${payload.body.weight_trend_kg_per_week.toFixed(2)} kg/week` },
              ]} />
            </Panel>
          </div>
        </div>
      )}
    </div>
  )
}
