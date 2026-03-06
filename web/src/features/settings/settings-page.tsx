import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { ActionButton, DataList, EmptyState, LabelledInput, PageIntro, Panel } from '../../components/ui'
import { api } from '../../lib/api'
import { queryClient } from '../../lib/query-client'

export function SettingsPage() {
  const sessionQuery = useQuery({ queryKey: ['session'], queryFn: api.getSession })
  const goalsQuery = useQuery({ queryKey: ['goals'], queryFn: api.listGoals })
  const apiKeysQuery = useQuery({ queryKey: ['api-keys'], queryFn: api.listApiKeys })
  const exportsQuery = useQuery({ queryKey: ['exports'], queryFn: api.listExports })
  const [goalDraft, setGoalDraft] = useState({ category: 'nutrition', title: 'Daily calories', metric_key: 'calories', target_value: '2800', unit: 'kcal', period: 'daily' })
  const [apiKeyName, setApiKeyName] = useState('openclaw')
  const [lastToken, setLastToken] = useState('')

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
    mutationFn: () => api.createApiKey({ name: apiKeyName, scopes: ['*'] }),
    onSuccess: async (result) => {
      setLastToken(result.token ?? '')
      await queryClient.invalidateQueries({ queryKey: ['api-keys'] })
    },
  })

  const createExport = useMutation({
    mutationFn: api.createExport,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['exports'] })
    },
  })

  return (
    <div className="space-y-4">
      <PageIntro
        eyebrow="Settings"
        title="Agent access, goals, and local operations"
        description="Issue API keys for OpenClaw, manage goals that feed the insights engine, and create local exports so the whole stack stays portable without any cloud dependency."
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_380px]">
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Active session" subtitle="Current local-auth context used by the web app.">
              {sessionQuery.data ? (
                <DataList rows={[
                  { label: 'Actor', value: sessionQuery.data.actor.display_name },
                  { label: 'Type', value: sessionQuery.data.actor.type },
                  { label: 'Scopes', value: sessionQuery.data.actor.scopes.join(', ') },
                ]} />
              ) : (
                <EmptyState title="Not signed in" body="Use the login screen to establish a local session before managing the system." />
              )}
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
                  <div key={goal.id} className="rounded-2xl bg-slate-100 px-4 py-3 text-sm text-slate-700">{goal.title}: {goal.target_value} {goal.unit}/{goal.period}</div>
                ))}
              </div>
            </Panel>
          </div>

          <Panel title="Exports" subtitle="Create local backups and keep restore-ready JSON on disk.">
            <div className="flex flex-wrap gap-3">
              <ActionButton onClick={() => createExport.mutate()}>Create export</ActionButton>
              <a className="inline-flex items-center justify-center rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-900" href={api.getAgentManifestUrl()} target="_blank" rel="noreferrer">Open agent manifest</a>
            </div>
            <div className="mt-4 space-y-3">
              {(exportsQuery.data?.items ?? []).map((record) => (
                <div key={record.id} className="rounded-[24px] border border-slate-200 bg-white px-4 py-4 text-sm">
                  <div className="font-semibold text-slate-950">{record.path}</div>
                  <div className="mt-1 text-slate-500">{record.created_at}</div>
                </div>
              ))}
              {!exportsQuery.data?.items?.length ? <EmptyState title="No exports yet" body="Create a backup before major refactors or before giving your agent broader write workflows." /> : null}
            </div>
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="OpenClaw API key" subtitle="Issue a full-control local token for your agent.">
            <LabelledInput label="Key name" value={apiKeyName} onChange={setApiKeyName} />
            <ActionButton className="mt-3" onClick={() => createKey.mutate()}>Generate key</ActionButton>
            {lastToken ? <div className="mt-4 rounded-[24px] bg-slate-950 px-4 py-4 text-sm text-canvas break-all">{lastToken}</div> : null}
            <div className="mt-4 space-y-3">
              {(apiKeysQuery.data?.items ?? []).map((record) => (
                <div key={record.id} className="rounded-[24px] bg-slate-100 px-4 py-4 text-sm text-slate-700">
                  <div className="font-semibold text-slate-950">{record.name}</div>
                  <div className="mt-1">{record.prefix}</div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Local defaults" subtitle="Bootstrap credentials and API endpoints for this install.">
            <DataList rows={[
              { label: 'Bootstrap user', value: 'owner' },
              { label: 'Bootstrap password', value: 'fitnesspal' },
              { label: 'API base', value: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api/v1' },
              { label: 'Agent manifest', value: api.getAgentManifestUrl() },
            ]} />
          </Panel>
        </div>
      </div>
    </div>
  )
}
