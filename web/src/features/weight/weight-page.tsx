import { useMutation, useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { EChart } from '../../components/charts/echart'
import { ActionButton, DataList, EmptyState, LabelledInput, LabelledTextArea, PageIntro, Panel } from '../../components/ui'
import { api } from '../../lib/api'
import { queryClient } from '../../lib/query-client'

function describeWeeklyTrend(value: number) {
  if (value >= 0.35) return 'Gaining quickly'
  if (value >= 0.1) return 'Slow lean gain'
  if (value <= -0.35) return 'Dropping quickly'
  if (value <= -0.1) return 'Slow cut'
  return 'Holding fairly steady'
}

export function WeightPage() {
  const [entryLimit, setEntryLimit] = useState(10)
  const entriesQuery = useQuery({ queryKey: ['weight-entries', entryLimit], queryFn: () => api.listWeightEntries({ limit: entryLimit }) })
  const trendsQuery = useQuery({ queryKey: ['weight-trends'], queryFn: () => api.getWeightTrends(180) })
  const [draft, setDraft] = useState({
    weight_kg: '',
    body_fat_pct: '',
    waist_cm: '',
    notes: '',
  })
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null)

  const saveEntry = useMutation({
    mutationFn: () => (editingEntryId ? api.updateWeightEntry(editingEntryId, {
      weight_kg: Number(draft.weight_kg),
      body_fat_pct: draft.body_fat_pct ? Number(draft.body_fat_pct) : undefined,
      waist_cm: draft.waist_cm ? Number(draft.waist_cm) : undefined,
      notes: draft.notes || undefined,
    }) : api.createWeightEntry({
      weight_kg: Number(draft.weight_kg),
      body_fat_pct: draft.body_fat_pct ? Number(draft.body_fat_pct) : undefined,
      waist_cm: draft.waist_cm ? Number(draft.waist_cm) : undefined,
      notes: draft.notes || undefined,
    })),
    onSuccess: async () => {
      setDraft({ weight_kg: '', body_fat_pct: '', waist_cm: '', notes: '' })
      setEditingEntryId(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['weight-entries'] }),
        queryClient.invalidateQueries({ queryKey: ['weight-trends'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['insights'] }),
        queryClient.invalidateQueries({ queryKey: ['insights-summary'] }),
      ])
    },
  })

  const deleteEntry = useMutation({
    mutationFn: (entryId: string) => api.deleteWeightEntry(entryId),
    onSuccess: async (_, entryId) => {
      if (editingEntryId === entryId) {
        setEditingEntryId(null)
        setDraft({ weight_kg: '', body_fat_pct: '', waist_cm: '', notes: '' })
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['weight-entries'] }),
        queryClient.invalidateQueries({ queryKey: ['weight-trends'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['insights'] }),
        queryClient.invalidateQueries({ queryKey: ['insights-summary'] }),
      ])
    },
  })

  const entries = entriesQuery.data?.items ?? []
  const points = trendsQuery.data?.points ?? []
  const latestEntry = entries[0]
  const latestTrendPoint = points.length ? points[points.length - 1] : undefined

  const summaryRows = useMemo(() => [
    { label: 'Latest weight', value: latestEntry ? `${latestEntry.weight_kg} kg` : 'No entry yet' },
    { label: '7-day average', value: latestTrendPoint ? `${latestTrendPoint.trend_7.toFixed(1)} kg` : 'Waiting for trend data' },
    { label: '30-day average', value: latestTrendPoint ? `${latestTrendPoint.trend_30.toFixed(1)} kg` : 'Waiting for trend data' },
    {
      label: 'Weekly rate',
      value: `${trendsQuery.data?.weight_trend_kg_per_week?.toFixed(2) ?? '0.00'} kg/week`,
    },
  ], [latestEntry, latestTrendPoint, trendsQuery.data?.weight_trend_kg_per_week])

  return (
    <div className="space-y-4">
      <PageIntro
        eyebrow="Body Metrics"
        title="Make the weigh-in a 20 second habit"
        description="Capture scale weight fast on your phone, tuck optional measurements behind one tap, and let the trend view smooth out the noisy days before it affects your nutrition or training decisions."
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(320px,1.05fr)]">
        <div className="space-y-4">
          <Panel title="Morning weigh-in" subtitle="Weight first. Everything else is optional.">
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault()
                saveEntry.mutate()
              }}
            >
              <LabelledInput
                label="Weight (kg)"
                type="number"
                step="0.1"
                value={draft.weight_kg}
                onChange={(value) => setDraft((current) => ({ ...current, weight_kg: value }))}
                placeholder="82.4"
              />

              <div className="grid gap-3 grid-cols-2">
                <div className="rounded-[22px] bg-slate-50 p-4 ring-1 ring-slate-200">
                  <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Latest</div>
                  <div className="mt-2 font-display text-3xl text-slate-950">{latestEntry ? `${latestEntry.weight_kg}` : '--'}</div>
                  <div className="mt-1 text-sm text-slate-500">kg</div>
                </div>
                <div className="rounded-[22px] bg-slate-950 p-4 text-canvas">
                  <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Weekly trend</div>
                  <div className="mt-2 font-display text-3xl">{trendsQuery.data?.weight_trend_kg_per_week?.toFixed(2) ?? '0.00'}</div>
                  <div className="mt-1 text-sm text-slate-300">kg per week</div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <ActionButton type="submit" className="w-full sm:w-auto">{editingEntryId ? 'Update weigh-in' : 'Save weigh-in'}</ActionButton>
                {editingEntryId ? <ActionButton tone="secondary" onClick={() => { setEditingEntryId(null); setDraft({ weight_kg: '', body_fat_pct: '', waist_cm: '', notes: '' }) }} className="w-full sm:w-auto">Cancel</ActionButton> : null}
              </div>

              <details className="rounded-[22px] border border-slate-200 bg-white">
                <summary className="cursor-pointer list-none px-4 py-4">
                  <div className="font-semibold text-slate-950">Optional body measurements</div>
                  <div className="mt-1 text-sm text-slate-500">Use this when you want extra context, not every day.</div>
                </summary>
                <div className="border-t border-slate-200 px-4 py-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <LabelledInput
                      label="Body fat %"
                      type="number"
                      step="0.1"
                      value={draft.body_fat_pct}
                      onChange={(value) => setDraft((current) => ({ ...current, body_fat_pct: value }))}
                    />
                    <LabelledInput
                      label="Waist (cm)"
                      type="number"
                      step="0.1"
                      value={draft.waist_cm}
                      onChange={(value) => setDraft((current) => ({ ...current, waist_cm: value }))}
                    />
                  </div>
                  <div className="mt-3">
                    <LabelledTextArea
                      label="Notes"
                      value={draft.notes}
                      onChange={(value) => setDraft((current) => ({ ...current, notes: value }))}
                      rows={3}
                      placeholder="Travel day, heavy refeed, poor sleep, etc."
                    />
                  </div>
                </div>
              </details>
            </form>
          </Panel>

          <Panel title="Recent check-ins" subtitle="The last few entries stay close so the habit feels grounded in actual history.">
            <div className="space-y-3">
              {entries.map((entry) => (
                <div key={entry.id} className="rounded-[22px] border border-slate-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs uppercase tracking-[0.2em] text-slate-500">{new Date(entry.logged_at).toLocaleDateString()}</div>
                      <div className="mt-2 font-display text-3xl text-slate-950">{entry.weight_kg} kg</div>
                    </div>
                    <div className="rounded-full bg-slate-100 px-3 py-2 text-sm text-slate-700">
                      {'sync_status' in entry && entry.sync_status === 'queued'
                        ? 'Queued sync'
                        : entry.body_fat_pct != null ? `${entry.body_fat_pct}% BF` : 'Scale only'}
                    </div>
                  </div>
                  {entry.waist_cm != null ? <div className="mt-3 text-sm text-slate-500">Waist: {entry.waist_cm} cm</div> : null}
                  {entry.notes ? <div className="mt-2 text-sm text-slate-500">{entry.notes}</div> : null}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <ActionButton
                      tone="secondary"
                      onClick={() => {
                        setEditingEntryId(entry.id)
                        setDraft({
                          weight_kg: String(entry.weight_kg),
                          body_fat_pct: entry.body_fat_pct != null ? String(entry.body_fat_pct) : '',
                          waist_cm: entry.waist_cm != null ? String(entry.waist_cm) : '',
                          notes: entry.notes ?? '',
                        })
                      }}
                      className="w-auto"
                    >
                      Edit
                    </ActionButton>
                    <ActionButton tone="secondary" onClick={() => deleteEntry.mutate(entry.id)} className="w-auto">Delete</ActionButton>
                  </div>
                </div>
              ))}
              {!entries.length ? <EmptyState title="No weigh-ins yet" body="Log the first morning weight and the trend cards will start to become useful almost immediately." /> : null}
              {entriesQuery.data?.has_more ? (
                <ActionButton tone="secondary" onClick={() => setEntryLimit((current) => current + 10)} className="w-full sm:w-auto">
                  Load more check-ins
                </ActionButton>
              ) : null}
            </div>
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="Trend view" subtitle="Use the smoothed lines to make decisions instead of reacting to every spike.">
            {points.length ? (
              <EChart
                style={{ height: 300 }}
                option={{
                  animationDuration: 700,
                  tooltip: { trigger: 'axis' },
                  grid: { left: 24, right: 18, top: 28, bottom: 24 },
                  xAxis: {
                    type: 'category',
                    data: points.map((point) => new Date(point.logged_at).toLocaleDateString()),
                    axisLabel: { color: '#64748b' },
                  },
                  yAxis: {
                    type: 'value',
                    axisLabel: { color: '#64748b' },
                    splitLine: { lineStyle: { color: '#e2e8f0' } },
                  },
                  series: [
                    {
                      name: 'Weight',
                      type: 'line',
                      smooth: true,
                      data: points.map((point) => point.weight_kg),
                      lineStyle: { color: '#fb7185', width: 2 },
                      symbol: 'circle',
                      symbolSize: 6,
                    },
                    {
                      name: '7-day',
                      type: 'line',
                      smooth: true,
                      data: points.map((point) => point.trend_7),
                      lineStyle: { color: '#0ea5e9', width: 2 },
                      symbol: 'none',
                    },
                    {
                      name: '30-day',
                      type: 'line',
                      smooth: true,
                      data: points.map((point) => point.trend_30),
                      lineStyle: { color: '#84cc16', width: 2 },
                      symbol: 'none',
                    },
                  ],
                }}
              />
            ) : (
              <EmptyState title="No trend data yet" body="A few consecutive weigh-ins are enough for the chart to become much more useful than the raw scale alone." />
            )}
          </Panel>

          <Panel title="What the trend says" subtitle="A quick reading for calories, recovery, and expectations.">
            <div className="space-y-4">
              <div className="app-status app-status-warning rounded-[24px] p-4 text-sm">
                <div className="text-xs uppercase tracking-[0.2em]">Current read</div>
                <div className="mt-2 font-display text-2xl">{describeWeeklyTrend(trendsQuery.data?.weight_trend_kg_per_week ?? 0)}</div>
                <p className="mt-2 leading-6">
                  Weekly change is {trendsQuery.data?.weight_trend_kg_per_week?.toFixed(2) ?? '0.00'} kg/week. Use that as the input for calorie adjustments, not one noisy weigh-in.
                </p>
              </div>

              <DataList rows={summaryRows} />
            </div>
          </Panel>
        </div>
      </div>
    </div>
  )
}
