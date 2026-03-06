import { useMutation, useQuery } from '@tanstack/react-query'
import ReactECharts from 'echarts-for-react'
import { useState } from 'react'

import { ActionButton, EmptyState, LabelledInput, PageIntro, Panel } from '../../components/ui'
import { api } from '../../lib/api'
import { queryClient } from '../../lib/query-client'

export function WeightPage() {
  const entriesQuery = useQuery({ queryKey: ['weight-entries'], queryFn: api.listWeightEntries })
  const trendsQuery = useQuery({ queryKey: ['weight-trends'], queryFn: api.getWeightTrends })
  const [draft, setDraft] = useState({ weight_kg: '82.4', body_fat_pct: '15.8', waist_cm: '84.2' })

  const createEntry = useMutation({
    mutationFn: () => api.createWeightEntry({
      weight_kg: Number(draft.weight_kg),
      body_fat_pct: Number(draft.body_fat_pct),
      waist_cm: Number(draft.waist_cm),
    }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['weight-entries'] }),
        queryClient.invalidateQueries({ queryKey: ['weight-trends'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['insights'] }),
      ])
    },
  })

  const points = trendsQuery.data?.points ?? []

  return (
    <div className="space-y-4">
      <PageIntro
        eyebrow="Body Metrics"
        title="Weigh-ins with less noise"
        description="Daily scale weight matters more when the app smooths it. Track raw weigh-ins, 7-day averages, and longer trend lines so calories and training decisions stay tied to signal, not water swings."
      />

      <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Panel title="Log weigh-in" subtitle="One quick input, plus optional body-fat and waist measurements.">
          <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); createEntry.mutate() }}>
            <LabelledInput label="Weight (kg)" type="number" step="0.1" value={draft.weight_kg} onChange={(value) => setDraft((current) => ({ ...current, weight_kg: value }))} />
            <LabelledInput label="Body fat %" type="number" step="0.1" value={draft.body_fat_pct} onChange={(value) => setDraft((current) => ({ ...current, body_fat_pct: value }))} />
            <LabelledInput label="Waist (cm)" type="number" step="0.1" value={draft.waist_cm} onChange={(value) => setDraft((current) => ({ ...current, waist_cm: value }))} />
            <ActionButton type="submit">Save weigh-in</ActionButton>
          </form>
          <div className="mt-6 rounded-[24px] bg-slate-100 p-4">
            <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Weekly trend</div>
            <div className="mt-2 font-display text-3xl">{trendsQuery.data?.weight_trend_kg_per_week?.toFixed(2) ?? '0.00'} kg/week</div>
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel title="Trend view" subtitle="Raw weight plus 7-day and 30-day smoothing.">
            {points.length ? (
              <ReactECharts
                style={{ height: 340 }}
                option={{
                  animationDuration: 700,
                  tooltip: { trigger: 'axis' },
                  legend: { textStyle: { color: '#475569' } },
                  xAxis: { type: 'category', data: points.map((point) => new Date(point.logged_at).toLocaleDateString()) },
                  yAxis: { type: 'value' },
                  series: [
                    { name: 'Weight', type: 'line', smooth: true, data: points.map((point) => point.weight_kg), lineStyle: { color: '#fb7185' } },
                    { name: '7-day', type: 'line', smooth: true, data: points.map((point) => point.trend_7), lineStyle: { color: '#0ea5e9' } },
                    { name: '30-day', type: 'line', smooth: true, data: points.map((point) => point.trend_30), lineStyle: { color: '#84cc16' } },
                  ],
                }}
              />
            ) : (
              <EmptyState title="No trend data yet" body="Add a few weigh-ins and the smoothing lines will start to tell a more useful story than the raw scale alone." />
            )}
          </Panel>

          <Panel title="Recent weigh-ins" subtitle="Latest entries exactly as logged.">
            <div className="grid gap-3 md:grid-cols-2">
              {(entriesQuery.data?.items ?? []).slice(0, 6).map((entry) => (
                <div key={entry.id} className="rounded-[24px] bg-white px-4 py-4 ring-1 ring-slate-200">
                  <div className="text-xs uppercase tracking-[0.2em] text-slate-500">{new Date(entry.logged_at).toLocaleDateString()}</div>
                  <div className="mt-2 font-display text-3xl text-slate-950">{entry.weight_kg} kg</div>
                  <div className="mt-2 text-sm text-slate-500">{entry.body_fat_pct ? `${entry.body_fat_pct}% body fat` : 'Body fat omitted'}</div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  )
}
