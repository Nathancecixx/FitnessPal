import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { ActionButton, DataList, EmptyState, LabelledInput, LabelledSelect, LabelledTextArea, PageIntro, Panel } from '../../components/ui'
import { api } from '../../lib/api'
import { queryClient } from '../../lib/query-client'

const apiKeyPresets = [
  { label: 'Assistant (Recommended)', value: 'assistant', scopes: ['assistant:use', 'nutrition:*', 'training:*', 'metrics:*', 'insights:*', 'platform:read'] },
  { label: 'Full access', value: 'full', scopes: ['*'] },
  { label: 'Read only', value: 'readonly', scopes: ['platform:read', 'nutrition:read', 'training:read', 'metrics:read', 'insights:read'] },
  { label: 'Nutrition only', value: 'nutrition', scopes: ['nutrition:*', 'metrics:read', 'insights:read'] },
  { label: 'Training only', value: 'training', scopes: ['training:*', 'metrics:read', 'insights:read'] },
] as const

export function SettingsPage() {
  const sessionQuery = useQuery({ queryKey: ['session'], queryFn: api.getSession })
  const goalsQuery = useQuery({ queryKey: ['goals'], queryFn: api.listGoals })
  const apiKeysQuery = useQuery({ queryKey: ['api-keys'], queryFn: api.listApiKeys })
  const exportsQuery = useQuery({ queryKey: ['exports'], queryFn: api.listExports })
  const runtimeQuery = useQuery({ queryKey: ['runtime'], queryFn: api.getRuntime })
  const jobsQuery = useQuery({
    queryKey: ['jobs'],
    queryFn: () => api.listJobs(),
    refetchInterval: 5000,
  })

  const [goalDraft, setGoalDraft] = useState({ category: 'nutrition', title: 'Daily calories', metric_key: 'calories', target_value: '2800', unit: 'kcal', period: 'daily' })
  const [apiKeyName, setApiKeyName] = useState('openclaw')
  const [apiKeyPreset, setApiKeyPreset] = useState<(typeof apiKeyPresets)[number]['value']>('assistant')
  const [lastToken, setLastToken] = useState('')
  const [restoreText, setRestoreText] = useState('')
  const [restoreStatus, setRestoreStatus] = useState('')

  const createGoal = useMutation({
    mutationFn: () => api.createGoal({
      category: goalDraft.category,
      title: goalDraft.title,
      metric_key: goalDraft.metric_key,
      target_value: Number(goalDraft.target_value),
      unit: goalDraft.unit,
      period: goalDraft.period,
    }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['goals'] }),
        queryClient.invalidateQueries({ queryKey: ['insights'] }),
      ])
    },
  })

  const createKey = useMutation({
    mutationFn: () => api.createApiKey({
      name: apiKeyName,
      scopes: apiKeyPresets.find((preset) => preset.value === apiKeyPreset)?.scopes ?? ['assistant:use'],
    }),
    onSuccess: async (result) => {
      setLastToken(result.token ?? '')
      await queryClient.invalidateQueries({ queryKey: ['api-keys'] })
    },
  })

  const deleteGoal = useMutation({
    mutationFn: (goalId: string) => api.deleteGoal(goalId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['goals'] }),
        queryClient.invalidateQueries({ queryKey: ['insights'] }),
      ])
    },
  })

  const revokeKey = useMutation({
    mutationFn: (keyId: string) => api.revokeApiKey(keyId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['api-keys'] })
    },
  })

  const createExport = useMutation({
    mutationFn: api.createExport,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['exports'] }),
        queryClient.invalidateQueries({ queryKey: ['runtime'] }),
      ])
    },
  })

  const restoreExport = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.restoreExport(payload),
    onSuccess: async (result) => {
      setRestoreStatus(`Restore complete. Tables updated: ${Object.keys(result.counts).length}`)
      await Promise.all([
        queryClient.invalidateQueries(),
      ])
    },
    onError: (error) => setRestoreStatus(error.message),
  })

  async function handleRestoreSubmit() {
    try {
      setRestoreStatus('Validating restore payload...')
      restoreExport.mutate(JSON.parse(restoreText) as Record<string, unknown>)
    } catch (error) {
      setRestoreStatus(error instanceof Error ? error.message : 'Invalid JSON payload.')
    }
  }

  return (
    <div className="space-y-4">
      <PageIntro
        eyebrow="Settings"
        title="Agent access, runtime status, and local operations"
        description="Issue API keys for OpenClaw, verify the Ollama connection the worker is using, inspect background jobs, and create or restore local exports without touching any cloud service."
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_380px]">
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Active runtime" subtitle="Current server, worker, and Ollama-facing configuration.">
              {runtimeQuery.data ? (
                <DataList rows={[
                  { label: 'App', value: runtimeQuery.data.app_name },
                  { label: 'Storage', value: runtimeQuery.data.storage_root },
                  { label: 'Local AI', value: runtimeQuery.data.local_ai.configured ? runtimeQuery.data.local_ai.model : 'Not configured' },
                  { label: 'AI reachable', value: runtimeQuery.data.local_ai.reachable ? 'Yes' : 'No' },
                  { label: 'Model available', value: runtimeQuery.data.local_ai.selected_model_available ? 'Yes' : 'No' },
                  { label: 'AI endpoint', value: runtimeQuery.data.local_ai.base_url ?? 'Unset' },
                  { label: 'Queued jobs', value: runtimeQuery.data.jobs.queued },
                  { label: 'Running jobs', value: runtimeQuery.data.jobs.running },
                  { label: 'Failed jobs', value: runtimeQuery.data.jobs.failed },
                ]} />
              ) : (
                <EmptyState title="Runtime unavailable" body="The web app could not fetch server runtime details." />
              )}
              {runtimeQuery.data?.local_ai.error ? <div className="mt-3 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-900">{runtimeQuery.data.local_ai.error}</div> : null}
            </Panel>

            <Panel title="Goals" subtitle="Targets that drive nutrition and bodyweight recommendations.">
              <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); createGoal.mutate() }}>
                <LabelledInput label="Goal title" value={goalDraft.title} onChange={(value) => setGoalDraft((current) => ({ ...current, title: value }))} />
                <LabelledInput label="Category" value={goalDraft.category} onChange={(value) => setGoalDraft((current) => ({ ...current, category: value }))} />
                <LabelledInput label="Metric key" value={goalDraft.metric_key} onChange={(value) => setGoalDraft((current) => ({ ...current, metric_key: value }))} />
                <div className="grid gap-3 sm:grid-cols-3">
                  <LabelledInput label="Target" type="number" value={goalDraft.target_value} onChange={(value) => setGoalDraft((current) => ({ ...current, target_value: value }))} />
                  <LabelledInput label="Unit" value={goalDraft.unit} onChange={(value) => setGoalDraft((current) => ({ ...current, unit: value }))} />
                  <LabelledInput label="Period" value={goalDraft.period} onChange={(value) => setGoalDraft((current) => ({ ...current, period: value }))} />
                </div>
                <ActionButton type="submit">Save goal</ActionButton>
              </form>
              <div className="mt-4 space-y-2">
                {(goalsQuery.data?.items ?? []).map((goal) => (
                  <div key={goal.id} className="rounded-2xl bg-slate-100 px-4 py-3 text-sm text-slate-700">
                    <div className="flex items-start justify-between gap-3">
                      <div>{goal.title}: {goal.target_value} {goal.unit}/{goal.period}</div>
                      <ActionButton tone="secondary" onClick={() => deleteGoal.mutate(goal.id)} className="w-auto">Delete</ActionButton>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          </div>

          <Panel title="Exports and restore" subtitle="Create local backups and restore JSON payloads into the current database.">
            <div className="flex flex-wrap gap-3">
              <ActionButton onClick={() => createExport.mutate()}>Create export</ActionButton>
              <a className="inline-flex items-center justify-center rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-900" href={api.getAgentManifestUrl()} target="_blank" rel="noreferrer">Open agent manifest</a>
            </div>
            <div className="mt-4 space-y-3">
              {(exportsQuery.data?.items ?? []).map((record) => (
                <div key={record.id} className="rounded-[24px] border border-slate-200 bg-white px-4 py-4 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-slate-950">{record.path}</div>
                      <div className="mt-1 text-slate-500">{record.created_at}</div>
                    </div>
                    <a className="inline-flex items-center justify-center rounded-full bg-slate-100 px-4 py-2 font-semibold text-slate-900" href={`/api/v1/exports/${record.id}/download`} target="_blank" rel="noreferrer">Download</a>
                  </div>
                </div>
              ))}
              {!exportsQuery.data?.items?.length ? <EmptyState title="No exports yet" body="Create a backup before major refactors or before giving your agent broader write workflows." /> : null}
            </div>
            <div className="mt-5 rounded-[24px] bg-slate-50 p-4">
              <LabelledTextArea label="Restore JSON" value={restoreText} onChange={setRestoreText} rows={8} placeholder="Paste a FitnessPal export payload here" />
              <div className="mt-3 flex flex-wrap gap-3">
                <label className="inline-flex cursor-pointer items-center justify-center rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-900 ring-1 ring-slate-200">
                  Load from file
                  <input type="file" accept="application/json" className="hidden" onChange={async (event) => {
                    const file = event.target.files?.[0]
                    if (!file) return
                    setRestoreText(await file.text())
                  }} />
                </label>
                <ActionButton onClick={handleRestoreSubmit}>Restore export</ActionButton>
              </div>
              {restoreStatus ? <div className="mt-3 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900">{restoreStatus}</div> : null}
            </div>
          </Panel>

          <Panel title="Background jobs" subtitle="Live view of the worker queue and the last processed tasks.">
            <div className="space-y-3">
              {(jobsQuery.data?.items ?? []).map((job) => (
                <div key={job.id} className="rounded-[24px] border border-slate-200 bg-white px-4 py-4 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-semibold text-slate-950">{job.job_type}</div>
                      <div className="mt-1 text-slate-500">{job.status} - attempt {job.attempts}/{job.max_attempts}</div>
                    </div>
                    <div className="text-xs uppercase tracking-[0.15em] text-slate-400">{new Date(job.created_at).toLocaleString()}</div>
                  </div>
                  {job.last_error ? <div className="mt-3 rounded-2xl bg-rose-50 px-3 py-2 text-rose-900">{job.last_error}</div> : null}
                </div>
              ))}
              {!jobsQuery.data?.items?.length ? <EmptyState title="No jobs yet" body="As you log meals, upload photos, or trigger backups, the worker queue will appear here." /> : null}
            </div>
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="OpenClaw API key" subtitle="Issue a full-control local token for your agent.">
            <LabelledInput label="Key name" value={apiKeyName} onChange={setApiKeyName} />
            <div className="mt-3">
              <LabelledSelect
                label="Scope preset"
                value={apiKeyPreset}
                onChange={(value) => setApiKeyPreset(value as (typeof apiKeyPresets)[number]['value'])}
                options={apiKeyPresets.map((preset) => ({ label: preset.label, value: preset.value }))}
              />
            </div>
            <ActionButton className="mt-3" onClick={() => createKey.mutate()}>Generate key</ActionButton>
            {lastToken ? <div className="mt-4 rounded-[24px] bg-slate-950 px-4 py-4 text-sm text-canvas break-all">{lastToken}</div> : null}
            <div className="mt-4 space-y-3">
              {(apiKeysQuery.data?.items ?? []).map((record) => (
                <div key={record.id} className="rounded-[24px] bg-slate-100 px-4 py-4 text-sm text-slate-700">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-slate-950">{record.name}</div>
                      <div className="mt-1">{record.prefix}</div>
                      <div className="mt-2 text-xs text-slate-500">{record.scopes.join(', ')}</div>
                    </div>
                    <ActionButton tone="secondary" onClick={() => revokeKey.mutate(record.id)} className="w-auto">Revoke</ActionButton>
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Session" subtitle="Current local-auth context used by the web app.">
            {sessionQuery.data ? (
              <DataList rows={[
                { label: 'Actor', value: sessionQuery.data.actor.display_name },
                { label: 'Type', value: sessionQuery.data.actor.type },
                { label: 'Scopes', value: sessionQuery.data.actor.scopes.join(', ') },
                { label: 'API base', value: runtimeQuery.data?.api_prefix ?? '/api/v1' },
                { label: 'Agent manifest', value: api.getAgentManifestUrl() },
              ]} />
            ) : (
              <EmptyState title="Not signed in" body="Use the login screen to establish a local session before managing the system." />
            )}
          </Panel>
        </div>
      </div>
    </div>
  )
}

