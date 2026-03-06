import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { ActionButton, DataList, EmptyState, LabelledInput, LabelledSelect, LabelledTextArea, PageIntro, Panel } from '../../components/ui'
import { api, type UserSetupResponse } from '../../lib/api'
import { queryClient } from '../../lib/query-client'
import { AiAdminPanel } from './ai-admin-panel'

const apiKeyPresets = [
  { label: 'Assistant (Recommended)', value: 'assistant', scopes: ['assistant:use', 'nutrition:*', 'training:*', 'metrics:*', 'insights:*', 'platform:read'] },
  { label: 'Full access', value: 'full', scopes: ['*'] },
  { label: 'Read only', value: 'readonly', scopes: ['platform:read', 'nutrition:read', 'training:read', 'metrics:read', 'insights:read'] },
  { label: 'Nutrition only', value: 'nutrition', scopes: ['nutrition:*', 'metrics:read', 'insights:read'] },
  { label: 'Training only', value: 'training', scopes: ['training:*', 'metrics:read', 'insights:read'] },
] as const

function resolveSetupUser(result: UserSetupResponse) {
  return result.user ?? {
    id: result.id ?? '',
    username: result.username ?? '',
    is_admin: result.is_admin ?? false,
    is_active: result.is_active ?? true,
    has_password: result.has_password ?? false,
    password_set_at: result.password_set_at ?? null,
    created_at: result.created_at ?? new Date().toISOString(),
  }
}

function resolveSetupUrl(result: UserSetupResponse) {
  return new URL(result.setup_path, window.location.origin).toString()
}

export function SettingsPage() {
  const sessionQuery = useQuery({ queryKey: ['session'], queryFn: api.getSession })
  const isAdmin = Boolean(sessionQuery.data?.user?.is_admin)
  const goalsQuery = useQuery({ queryKey: ['goals'], queryFn: api.listGoals })
  const apiKeysQuery = useQuery({ queryKey: ['api-keys'], queryFn: api.listApiKeys })
  const usersQuery = useQuery({ queryKey: ['users'], queryFn: api.listUsers, enabled: isAdmin })
  const exportsQuery = useQuery({ queryKey: ['exports'], queryFn: api.listExports })
  const runtimeQuery = useQuery({ queryKey: ['runtime'], queryFn: api.getRuntime })
  const jobsQuery = useQuery({
    queryKey: ['jobs'],
    queryFn: () => api.listJobs(),
    refetchInterval: 5000,
  })

  const [goalDraft, setGoalDraft] = useState({ category: 'nutrition', title: 'Daily calories', metric_key: 'calories', target_value: '2800', unit: 'kcal', period: 'daily' })
  const [apiKeyName, setApiKeyName] = useState('fitnesspal-client')
  const [apiKeyPreset, setApiKeyPreset] = useState<(typeof apiKeyPresets)[number]['value']>('assistant')
  const [lastToken, setLastToken] = useState('')
  const [restoreText, setRestoreText] = useState('')
  const [restoreStatus, setRestoreStatus] = useState('')
  const [passwordDraft, setPasswordDraft] = useState({ current: '', next: '', confirm: '' })
  const [userDraft, setUserDraft] = useState({ username: '', isAdmin: false })
  const [setupResult, setSetupResult] = useState<UserSetupResponse | null>(null)

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

  const createUser = useMutation({
    mutationFn: () => api.createUser({ username: userDraft.username.trim(), is_admin: userDraft.isAdmin }),
    onSuccess: async (result) => {
      setSetupResult(result)
      setUserDraft({ username: '', isAdmin: false })
      await queryClient.invalidateQueries({ queryKey: ['users'] })
    },
  })

  const issueSetup = useMutation({
    mutationFn: (userId: string) => api.issuePasswordSetup(userId),
    onSuccess: async (result) => {
      setSetupResult(result)
      await queryClient.invalidateQueries({ queryKey: ['users'] })
    },
  })

  const changePassword = useMutation({
    mutationFn: () => api.changePassword(passwordDraft.current, passwordDraft.next),
    onSuccess: async () => {
      setPasswordDraft({ current: '', next: '', confirm: '' })
      await queryClient.invalidateQueries({ queryKey: ['session'] })
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
      await queryClient.invalidateQueries()
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
        title="Accounts, coach control, and local operations"
        description="Manage admin-created users, configure AI backends, issue API keys for trusted local clients, inspect runtime and jobs, and export or restore only the signed-in user data."
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_380px]">
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Active runtime" subtitle="Current server, worker, and coach configuration for this user context.">
              {runtimeQuery.data ? (
                <DataList rows={[
                  { label: 'App', value: runtimeQuery.data.app_name },
                  { label: 'Uploads root', value: runtimeQuery.data.uploads_root },
                  { label: 'Exports root', value: runtimeQuery.data.exports_root },
                  { label: 'AI profiles', value: runtimeQuery.data.ai.profiles.length },
                  { label: 'Configured features', value: runtimeQuery.data.ai.configured_feature_count },
                  { label: 'Legacy fallback', value: runtimeQuery.data.ai.legacy_mode ? 'Yes' : 'No' },
                  { label: 'Coach persona', value: runtimeQuery.data.ai.persona.display_name },
                  { label: 'Queued jobs', value: runtimeQuery.data.jobs.queued },
                  { label: 'Running jobs', value: runtimeQuery.data.jobs.running },
                  { label: 'Failed jobs', value: runtimeQuery.data.jobs.failed },
                ]} />
              ) : (
                <EmptyState title="Runtime unavailable" body="The web app could not fetch server runtime details." />
              )}
            </Panel>

            <Panel title="Password" subtitle="Change the password for the current signed-in account.">
              <form className="grid gap-3" onSubmit={(event) => {
                event.preventDefault()
                changePassword.mutate()
              }}
              >
                <LabelledInput label="Current password" type="password" value={passwordDraft.current} onChange={(value) => setPasswordDraft((current) => ({ ...current, current: value }))} />
                <LabelledInput label="New password" type="password" value={passwordDraft.next} onChange={(value) => setPasswordDraft((current) => ({ ...current, next: value }))} />
                <LabelledInput label="Confirm password" type="password" value={passwordDraft.confirm} onChange={(value) => setPasswordDraft((current) => ({ ...current, confirm: value }))} />
                {passwordDraft.next && passwordDraft.confirm && passwordDraft.next !== passwordDraft.confirm ? (
                  <div className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-900">New passwords do not match.</div>
                ) : null}
                {changePassword.isError ? <div className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-900">{changePassword.error.message}</div> : null}
                {changePassword.isSuccess ? <div className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900">Password updated.</div> : null}
                <ActionButton type="submit" disabled={changePassword.isPending || passwordDraft.next.length < 8 || passwordDraft.next !== passwordDraft.confirm}>
                  Update password
                </ActionButton>
              </form>
            </Panel>
          </div>

          {isAdmin ? (
            <Panel title="Users" subtitle="Admin accounts can create users and issue one-time password setup links.">
              <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
                <form className="grid gap-3" onSubmit={(event) => {
                  event.preventDefault()
                  createUser.mutate()
                }}
                >
                  <LabelledInput label="Username" value={userDraft.username} onChange={(value) => setUserDraft((current) => ({ ...current, username: value }))} placeholder="alice" />
                  <label className="flex items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
                    <input type="checkbox" checked={userDraft.isAdmin} onChange={(event) => setUserDraft((current) => ({ ...current, isAdmin: event.target.checked }))} />
                    Create as admin
                  </label>
                  {createUser.isError ? <div className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-900">{createUser.error.message}</div> : null}
                  <ActionButton type="submit" disabled={!userDraft.username.trim() || createUser.isPending}>Create user</ActionButton>
                </form>

                <div className="space-y-3">
                  {setupResult ? (
                    <div className="rounded-[24px] bg-slate-950 px-4 py-4 text-sm text-canvas">
                      <div className="font-semibold">{resolveSetupUser(setupResult).username}</div>
                      <div className="mt-2 break-all">{resolveSetupUrl(setupResult)}</div>
                      <div className="mt-2 break-all text-slate-300">{setupResult.setup_token}</div>
                      <div className="mt-2 text-xs text-slate-400">Expires: {new Date(setupResult.setup_expires_at).toLocaleString()}</div>
                    </div>
                  ) : null}

                  {(usersQuery.data?.items ?? []).map((user) => (
                    <div key={user.id} className="rounded-[24px] border border-slate-200 bg-white px-4 py-4 text-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-semibold text-slate-950">{user.username}</div>
                          <div className="mt-1 text-slate-500">{user.is_admin ? 'Admin' : 'User'} - {user.has_password ? 'Password set' : 'Pending setup'}</div>
                          <div className="mt-1 text-xs text-slate-400">Created {new Date(user.created_at).toLocaleString()}</div>
                        </div>
                        <ActionButton tone="secondary" onClick={() => issueSetup.mutate(user.id)} className="w-auto">Issue link</ActionButton>
                      </div>
                    </div>
                  ))}
                  {!usersQuery.data?.items?.length ? <EmptyState title="No managed users yet" body="Create the first non-admin user and share the issued setup link so they can choose their own password." /> : null}
                </div>
              </div>
            </Panel>
          ) : null}

          {isAdmin ? <AiAdminPanel /> : null}

          <Panel title="Exports and restore" subtitle="Create local backups and restore JSON payloads into the current signed-in user data scope.">
            <div className="flex flex-wrap gap-3">
              <ActionButton onClick={() => createExport.mutate()}>Create export</ActionButton>
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
              {!exportsQuery.data?.items?.length ? <EmptyState title="No exports yet" body="Create a backup before large refactors or before testing a new client against your data." /> : null}
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

          <Panel title="Background jobs" subtitle="Live view of the worker queue for the current user.">
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
          <Panel title="Integration API keys" subtitle="Issue scoped local tokens for private scripts, automations, and trusted clients.">
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

          <Panel title="Session" subtitle="Current auth context used by the web app.">
            {sessionQuery.data ? (
              <DataList rows={[
                { label: 'Actor', value: sessionQuery.data.actor.display_name },
                { label: 'Type', value: sessionQuery.data.actor.type },
                { label: 'Username', value: sessionQuery.data.user?.username ?? 'Unknown' },
                { label: 'Role', value: sessionQuery.data.user?.is_admin ? 'Admin' : 'User' },
                { label: 'Scopes', value: sessionQuery.data.actor.scopes.join(', ') },
                { label: 'API base', value: runtimeQuery.data?.api_prefix ?? '/api/v1' },
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
      </div>
    </div>
  )
}
