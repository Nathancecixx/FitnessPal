import { useMutation, useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { CoachNudgePanel, filterCoachNudges } from '../../components/coach-panels'
import { EChart } from '../../components/charts/echart'
import { ActionButton, ConfirmSheet, type ConfirmSheetRequest, DataList, DraftStatusBanner, EmptyState, ErrorState, LabelledInput, LabelledTextArea, LoadingState, PageIntro, Panel } from '../../components/ui'
import { api } from '../../lib/api'
import { useDraftState } from '../../lib/draft-store'
import { invalidateWeightQueries } from '../../lib/query-invalidations'
import { queryClient } from '../../lib/query-client'
import { useWeightUnit } from '../../lib/user-preferences'
import { convertMassFromKg, convertMassToKg, formatMass, formatMassInput, formatMassRate, getWeightUnitLabel } from '../../lib/weight-units'

function describeWeeklyTrend(value: number) {
  if (value >= 0.35) return 'Gaining quickly'
  if (value >= 0.1) return 'Slow lean gain'
  if (value <= -0.35) return 'Dropping quickly'
  if (value <= -0.1) return 'Slow cut'
  return 'Holding fairly steady'
}

function toStartOfDayIso(value: string) {
  return value ? `${value}T00:00:00` : undefined
}

function toEndOfDayIso(value: string) {
  return value ? `${value}T23:59:59` : undefined
}

export function WeightPage() {
  const weightUnit = useWeightUnit()
  const weightUnitLabel = getWeightUnitLabel(weightUnit)
  const feedQuery = useQuery({ queryKey: ['assistant-feed'], queryFn: api.getAssistantFeed, retry: false })
  const [entryLimit, setEntryLimit] = useState(10)
  const [historyFilters, setHistoryFilters] = useState({ date_from: '', date_to: '' })
  const entryDraftState = useDraftState({
    formId: 'weight-entry',
    initialValue: {
      weight_kg: '',
      body_fat_pct: '',
      waist_cm: '',
      notes: '',
    },
    route: '/weight',
  })
  const draft = entryDraftState.value
  const setDraft = entryDraftState.setValue
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null)
  const [confirmRequest, setConfirmRequest] = useState<ConfirmSheetRequest | null>(null)

  const entriesQuery = useQuery({
    queryKey: ['weight-entries', entryLimit, historyFilters.date_from, historyFilters.date_to],
    queryFn: () => api.listWeightEntries({
      limit: entryLimit,
      date_from: toStartOfDayIso(historyFilters.date_from),
      date_to: toEndOfDayIso(historyFilters.date_to),
    }),
  })
  const trendsQuery = useQuery({ queryKey: ['weight-trends'], queryFn: () => api.getWeightTrends(180) })

  const weightError = !draft.weight_kg.trim()
    ? 'Weight is required.'
    : Number(draft.weight_kg) <= 0
      ? 'Weight must be greater than zero.'
      : ''
  const bodyFatError = draft.body_fat_pct && (Number(draft.body_fat_pct) < 0 || Number(draft.body_fat_pct) > 100)
    ? 'Body fat must stay between 0 and 100.'
    : ''
  const waistError = draft.waist_cm && Number(draft.waist_cm) <= 0
    ? 'Waist must be greater than zero.'
    : ''
  const formHasError = Boolean(weightError || bodyFatError || waistError)

  const saveEntry = useMutation({
    mutationFn: () => (editingEntryId ? api.updateWeightEntry(editingEntryId, {
      weight_kg: convertMassToKg(Number(draft.weight_kg), weightUnit),
      body_fat_pct: draft.body_fat_pct ? Number(draft.body_fat_pct) : null,
      waist_cm: draft.waist_cm ? Number(draft.waist_cm) : null,
      notes: draft.notes || null,
    }) : api.createWeightEntry({
      weight_kg: convertMassToKg(Number(draft.weight_kg), weightUnit),
      body_fat_pct: draft.body_fat_pct ? Number(draft.body_fat_pct) : null,
      waist_cm: draft.waist_cm ? Number(draft.waist_cm) : null,
      notes: draft.notes || null,
    })),
    onSuccess: async () => {
      entryDraftState.meta.clearDraft()
      setEditingEntryId(null)
      await invalidateWeightQueries()
    },
  })

  const deleteEntry = useMutation({
    mutationFn: (entryId: string) => api.deleteWeightEntry(entryId),
    onSuccess: async (_, entryId) => {
      if (editingEntryId === entryId) {
        setEditingEntryId(null)
        entryDraftState.meta.clearDraft()
      }
      await invalidateWeightQueries()
    },
  })

  const entries = entriesQuery.data?.items ?? []
  const points = trendsQuery.data?.points ?? []
  const latestEntry = entries[0]
  const latestTrendPoint = points.length ? points[points.length - 1] : undefined

  const summaryRows = useMemo(() => [
    { label: 'Latest weight', value: latestEntry ? formatMass(latestEntry.weight_kg, weightUnit) : 'No entry yet' },
    { label: '7-day average', value: latestTrendPoint ? formatMass(latestTrendPoint.trend_7, weightUnit) : 'Waiting for trend data' },
    { label: '30-day average', value: latestTrendPoint ? formatMass(latestTrendPoint.trend_30, weightUnit) : 'Waiting for trend data' },
    {
      label: 'Weekly rate',
      value: formatMassRate(trendsQuery.data?.weight_trend_kg_per_week ?? 0, weightUnit),
    },
  ], [latestEntry, latestTrendPoint, trendsQuery.data?.weight_trend_kg_per_week, weightUnit])
  const weightNudges = useMemo(() => filterCoachNudges(feedQuery.data?.feed.nudges, 'weight'), [feedQuery.data?.feed.nudges])

  function resetDraft() {
    setEditingEntryId(null)
    entryDraftState.meta.clearDraft()
  }

  function applyHistoryPreset(days: 7 | 30 | 90) {
    const dateTo = new Date()
    const dateFrom = new Date()
    dateFrom.setDate(dateFrom.getDate() - (days - 1))
    setHistoryFilters({
      date_from: dateFrom.toISOString().slice(0, 10),
      date_to: dateTo.toISOString().slice(0, 10),
    })
  }

  return (
    <div className="space-y-4">
      <PageIntro
        eyebrow="Body Metrics"
        title="Make the weigh-in a 20 second habit"
        description="Log weight fast and let the trend smooth out the noise."
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(320px,1.05fr)]">
        <div className="space-y-4">
          <CoachNudgePanel
            title="Coach cues"
            subtitle="Quick weight notes."
            nudges={weightNudges}
            emptyTitle="No weight cues right now"
            emptyBody="Coach notes will show up here when needed."
          />

          <Panel title="Morning weigh-in" subtitle="Weight first. Everything else is optional.">
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault()
                if (!formHasError) {
                  saveEntry.mutate()
                }
              }}
            >
              <DraftStatusBanner restored={entryDraftState.meta.restored} savedAt={entryDraftState.meta.savedAt} onDiscard={resetDraft} />
              <LabelledInput
                label={`Weight (${weightUnitLabel})`}
                type="number"
                step="0.1"
                value={draft.weight_kg}
                onChange={(value) => setDraft((current) => ({ ...current, weight_kg: value }))}
                placeholder={weightUnit === 'lbs' ? '181.7' : '82.4'}
                error={weightError || undefined}
              />

              <div className="grid gap-3 grid-cols-2">
                <div className="rounded-[22px] bg-slate-50 p-4 ring-1 ring-slate-200">
                  <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Latest</div>
                  <div className="mt-2 font-display text-3xl text-slate-950">{latestEntry ? formatMass(latestEntry.weight_kg, weightUnit, { includeUnit: false }) : '--'}</div>
                  <div className="mt-1 text-sm text-slate-500">{weightUnitLabel}</div>
                </div>
                <div className="rounded-[22px] bg-slate-950 p-4 text-canvas">
                  <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Weekly trend</div>
                  <div className="mt-2 font-display text-3xl">{formatMassRate(trendsQuery.data?.weight_trend_kg_per_week ?? 0, weightUnit, { includeUnit: false })}</div>
                  <div className="mt-1 text-sm text-slate-300">{weightUnitLabel} per week</div>
                </div>
              </div>

              {latestEntry?.body_fat_pct != null || latestEntry?.waist_cm != null || latestEntry?.notes ? (
                <div className="rounded-[22px] bg-slate-50 px-4 py-4 text-sm text-slate-600">
                  <div className="font-semibold text-slate-950">Reuse the last optional measurements</div>
                  <div className="mt-1 leading-6">Pull forward body fat, waist, and notes.</div>
                  <div className="mt-3">
                    <ActionButton
                      tone="secondary"
                      onClick={() => setDraft((current) => ({
                        ...current,
                        body_fat_pct: latestEntry.body_fat_pct != null ? String(latestEntry.body_fat_pct) : current.body_fat_pct,
                        waist_cm: latestEntry.waist_cm != null ? String(latestEntry.waist_cm) : current.waist_cm,
                        notes: latestEntry.notes ?? current.notes,
                      }))}
                      className="w-full sm:w-auto"
                    >
                      Reuse last optional fields
                    </ActionButton>
                  </div>
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <ActionButton type="submit" className="w-full sm:w-auto" disabled={saveEntry.isPending || formHasError}>
                  {editingEntryId ? 'Update weigh-in' : 'Save weigh-in'}
                </ActionButton>
                {editingEntryId ? <ActionButton tone="secondary" onClick={resetDraft} className="w-full sm:w-auto">Cancel</ActionButton> : null}
              </div>

              <details className="rounded-[22px] border border-slate-200 bg-white">
                <summary className="cursor-pointer list-none px-4 py-4">
                  <div className="font-semibold text-slate-950">Optional body measurements</div>
                  <div className="mt-1 text-sm text-slate-500">Add more detail when you want it.</div>
                </summary>
                <div className="border-t border-slate-200 px-4 py-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <LabelledInput
                      label="Body fat %"
                      type="number"
                      step="0.1"
                      value={draft.body_fat_pct}
                      onChange={(value) => setDraft((current) => ({ ...current, body_fat_pct: value }))}
                      error={bodyFatError || undefined}
                    />
                    <LabelledInput
                      label="Waist (cm)"
                      type="number"
                      step="0.1"
                      value={draft.waist_cm}
                      onChange={(value) => setDraft((current) => ({ ...current, waist_cm: value }))}
                      error={waistError || undefined}
                    />
                  </div>
                  <div className="mt-3">
                    <LabelledTextArea
                      label="Notes"
                      value={draft.notes}
                      onChange={(value) => setDraft((current) => ({ ...current, notes: value }))}
                      rows={3}
                      placeholder="Travel, poor sleep, refeed"
                    />
                  </div>
                </div>
              </details>
            </form>
          </Panel>

          <Panel title="Recent check-ins" subtitle="Latest weigh-ins.">
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <ActionButton tone="secondary" onClick={() => applyHistoryPreset(7)} className="w-auto">Last 7 days</ActionButton>
                <ActionButton tone="secondary" onClick={() => applyHistoryPreset(30)} className="w-auto">Last 30 days</ActionButton>
                <ActionButton tone="secondary" onClick={() => applyHistoryPreset(90)} className="w-auto">Last 90 days</ActionButton>
                <ActionButton tone="secondary" onClick={() => setHistoryFilters({ date_from: '', date_to: '' })} className="w-auto">All time</ActionButton>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <LabelledInput label="From" type="date" value={historyFilters.date_from} onChange={(value) => setHistoryFilters((current) => ({ ...current, date_from: value }))} />
                <LabelledInput label="To" type="date" value={historyFilters.date_to} onChange={(value) => setHistoryFilters((current) => ({ ...current, date_to: value }))} />
              </div>
              {entriesQuery.isLoading ? (
                <LoadingState title="Loading check-ins" body="Loading weigh-ins." />
              ) : entriesQuery.isError ? (
                <ErrorState title="Could not load check-ins" body={entriesQuery.error.message} action={<ActionButton onClick={() => entriesQuery.refetch()} className="w-auto">Retry</ActionButton>} />
              ) : (
                <div className="space-y-3">
                  {entries.map((entry) => (
                    <div key={entry.id} className="rounded-[22px] border border-slate-200 bg-white p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-xs uppercase tracking-[0.2em] text-slate-500">{new Date(entry.logged_at).toLocaleDateString()}</div>
                          <div className="mt-2 font-display text-3xl text-slate-950">{formatMass(entry.weight_kg, weightUnit)}</div>
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
                              weight_kg: formatMassInput(entry.weight_kg, weightUnit),
                              body_fat_pct: entry.body_fat_pct != null ? String(entry.body_fat_pct) : '',
                              waist_cm: entry.waist_cm != null ? String(entry.waist_cm) : '',
                              notes: entry.notes ?? '',
                            })
                          }}
                          className="w-auto"
                        >
                          Edit
                        </ActionButton>
                        <ActionButton
                          tone="secondary"
                          onClick={() => setConfirmRequest({
                            title: 'Delete this weigh-in?',
                            body: `Type ${formatMass(entry.weight_kg, weightUnit)} to confirm deleting this entry.`,
                            confirmLabel: 'Delete weigh-in',
                            confirmationValue: formatMass(entry.weight_kg, weightUnit),
                            confirmationHint: `Type ${formatMass(entry.weight_kg, weightUnit)} to confirm`,
                            isPending: deleteEntry.isPending,
                            onConfirm: () => deleteEntry.mutate(entry.id),
                          })}
                          className="w-auto"
                        >
                          Delete
                        </ActionButton>
                      </div>
                    </div>
                  ))}
                  {!entries.length ? <EmptyState title="No weigh-ins yet" body="Log your first weight to get started." /> : null}
                  {entriesQuery.data?.has_more ? (
                    <ActionButton tone="secondary" onClick={() => setEntryLimit((current) => current + 10)} className="w-full sm:w-auto">
                      Load more check-ins
                    </ActionButton>
                  ) : null}
                </div>
              )}
            </div>
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="Trend view" subtitle="Smoothed trend lines.">
            {trendsQuery.isLoading ? (
              <LoadingState title="Loading weight trends" body="Building your trend lines." />
            ) : trendsQuery.isError ? (
              <ErrorState title="Could not load trend data" body={trendsQuery.error.message} action={<ActionButton onClick={() => trendsQuery.refetch()} className="w-auto">Retry</ActionButton>} />
            ) : points.length ? (
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
                      name: `Weight (${weightUnitLabel})`,
                      type: 'line',
                      smooth: true,
                      data: points.map((point) => convertMassFromKg(point.weight_kg, weightUnit)),
                      lineStyle: { color: '#fb7185', width: 2 },
                      symbol: 'circle',
                      symbolSize: 6,
                    },
                    {
                      name: `7-day (${weightUnitLabel})`,
                      type: 'line',
                      smooth: true,
                      data: points.map((point) => convertMassFromKg(point.trend_7, weightUnit)),
                      lineStyle: { color: '#0ea5e9', width: 2 },
                      symbol: 'none',
                    },
                    {
                      name: `30-day (${weightUnitLabel})`,
                      type: 'line',
                      smooth: true,
                      data: points.map((point) => convertMassFromKg(point.trend_30, weightUnit)),
                      lineStyle: { color: '#84cc16', width: 2 },
                      symbol: 'none',
                    },
                  ],
                }}
              />
            ) : (
              <EmptyState title="No trend data yet" body="A few weigh-ins will fill this in." />
            )}
          </Panel>

          <Panel title="What the trend says" subtitle="Quick read.">
            <div className="space-y-4">
              <div className="app-status app-status-warning rounded-[24px] p-4 text-sm">
                <div className="text-xs uppercase tracking-[0.2em]">Current read</div>
                <div className="mt-2 font-display text-2xl">{describeWeeklyTrend(trendsQuery.data?.weight_trend_kg_per_week ?? 0)}</div>
                <p className="mt-2 leading-6">
                  Weekly change is {formatMassRate(trendsQuery.data?.weight_trend_kg_per_week ?? 0, weightUnit)}. Trust the trend, not a single spike.
                </p>
              </div>

              <DataList rows={summaryRows} />
            </div>
          </Panel>
        </div>
      </div>

      <ConfirmSheet request={confirmRequest} onClose={() => setConfirmRequest(null)} />
    </div>
  )
}
