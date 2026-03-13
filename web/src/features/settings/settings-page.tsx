import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useState, type ReactNode } from 'react'

import { ActionButton, DataList, EmptyState, LabelledInput, LabelledSelect, LabelledTextArea, Panel } from '../../components/ui'
import { api, type UserSetupResponse } from '../../lib/api'
import { queryClient } from '../../lib/query-client'
import { useUserPreferencesQuery } from '../../lib/user-preferences'
import { AiAdminPanel } from './ai-admin-panel'

const apiKeyPresets = [
  { label: 'Assistant (Recommended)', value: 'assistant', scopes: ['assistant:use', 'nutrition:*', 'training:*', 'metrics:*', 'insights:*', 'platform:read'] },
  { label: 'Full access', value: 'full', scopes: ['*'] },
  { label: 'Read only', value: 'readonly', scopes: ['platform:read', 'nutrition:read', 'training:read', 'metrics:read', 'insights:read'] },
  { label: 'Nutrition only', value: 'nutrition', scopes: ['nutrition:*', 'metrics:read', 'insights:read'] },
  { label: 'Training only', value: 'training', scopes: ['training:*', 'metrics:read', 'insights:read'] },
] as const

type SectionLink = {
  id: string
  label: string
  note: string
}

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

function formatTimestamp(value?: string | null) {
  if (!value) {
    return 'Not available'
  }

  return new Date(value).toLocaleString()
}

function countLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`
}

function detectBrowserTimezone() {
  if (typeof Intl === 'undefined') {
    return 'UTC'
  }
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

function SectionHeading(props: { id: string; eyebrow: string; title: string; description: string }) {
  return (
    <div id={props.id} className="scroll-mt-28 px-1">
      <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">{props.eyebrow}</div>
      <h2 className="mt-2 font-display text-3xl leading-none app-text-primary sm:text-[2.1rem]">{props.title}</h2>
      <p className="mt-3 max-w-3xl text-sm leading-6 app-text-muted md:text-base">{props.description}</p>
    </div>
  )
}

function HeroMetric(props: { label: string; value: ReactNode; detail: string }) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/10 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur">
      <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-300">{props.label}</div>
      <div className="mt-3 font-display text-[1.85rem] leading-none text-canvas">{props.value}</div>
      <p className="mt-2 text-sm leading-5 text-slate-300">{props.detail}</p>
    </div>
  )
}

function SectionLinkChip(props: SectionLink) {
  return (
    <a
      href={`#${props.id}`}
      className="inline-flex min-h-[52px] min-w-[148px] flex-col justify-center rounded-[22px] border border-white/10 bg-white/10 px-4 py-3 text-left transition hover:bg-white/15"
    >
      <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-300/80">{props.label}</span>
      <span className="mt-1 text-sm text-slate-200">{props.note}</span>
    </a>
  )
}

function PanelBadge(props: { children: ReactNode }) {
  return (
    <span className="app-card inline-flex min-h-[34px] items-center rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] app-text-muted">
      {props.children}
    </span>
  )
}

function StackCard(props: { title: ReactNode; body: ReactNode; meta?: ReactNode; action?: ReactNode; tone?: 'default' | 'muted' | 'inverse' }) {
  const toneClass = props.tone === 'inverse'
    ? 'border border-white/10 bg-slate-950/95 text-canvas'
    : props.tone === 'muted'
      ? 'app-card-muted border'
      : 'app-card border'

  const titleClass = props.tone === 'inverse' ? 'text-canvas' : 'app-text-primary'
  const bodyClass = props.tone === 'inverse' ? 'text-slate-300' : 'app-text-muted'
  const metaClass = props.tone === 'inverse' ? 'text-slate-400' : 'app-text-subtle'

  return (
    <div className={`rounded-[24px] px-4 py-4 shadow-sm ${toneClass}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className={`font-semibold break-words ${titleClass}`}>{props.title}</div>
          <div className={`mt-1 text-sm leading-6 ${bodyClass}`}>{props.body}</div>
          {props.meta ? <div className={`mt-2 text-xs ${metaClass}`}>{props.meta}</div> : null}
        </div>
        {props.action ? <div className="shrink-0">{props.action}</div> : null}
      </div>
    </div>
  )
}

export function SettingsPage() {
  const [jobLimit, setJobLimit] = useState(20)
  const [exportLimit, setExportLimit] = useState(10)
  const sessionQuery = useQuery({ queryKey: ['session'], queryFn: api.getSession })
  const preferencesQuery = useUserPreferencesQuery()
  const isAdmin = Boolean(sessionQuery.data?.user?.is_admin)
  const goalsQuery = useQuery({ queryKey: ['goals'], queryFn: api.listGoals })
  const apiKeysQuery = useQuery({ queryKey: ['api-keys'], queryFn: api.listApiKeys })
  const usersQuery = useQuery({ queryKey: ['users'], queryFn: api.listUsers, enabled: isAdmin })
  const exportsQuery = useQuery({ queryKey: ['exports', exportLimit], queryFn: () => api.listExports({ limit: exportLimit }) })
  const runtimeQuery = useQuery({ queryKey: ['runtime'], queryFn: api.getRuntime })
  const jobsQuery = useQuery({
    queryKey: ['jobs', jobLimit],
    queryFn: () => api.listJobs({ limit: jobLimit }),
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
  const [weightUnitDraft, setWeightUnitDraft] = useState<'kg' | 'lbs'>('kg')
  const [timezoneDraft, setTimezoneDraft] = useState(detectBrowserTimezone)
  const [setupResult, setSetupResult] = useState<UserSetupResponse | null>(null)

  useEffect(() => {
    if (preferencesQuery.data?.weight_unit) {
      setWeightUnitDraft(preferencesQuery.data.weight_unit)
    }
    setTimezoneDraft(preferencesQuery.data?.timezone ?? detectBrowserTimezone())
  }, [preferencesQuery.data?.timezone, preferencesQuery.data?.weight_unit])

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
        queryClient.invalidateQueries({ queryKey: ['assistant-feed'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['insights'] }),
        queryClient.invalidateQueries({ queryKey: ['insights-summary'] }),
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
        queryClient.invalidateQueries({ queryKey: ['assistant-feed'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['insights'] }),
        queryClient.invalidateQueries({ queryKey: ['insights-summary'] }),
      ])
    },
  })

  const updatePreferences = useMutation({
    mutationFn: () => api.updateUserPreferences({ weight_unit: weightUnitDraft, timezone: timezoneDraft.trim() || null }),
    onSuccess: async (result) => {
      queryClient.setQueryData(['user-preferences'], result)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['user-preferences'] }),
        queryClient.invalidateQueries({ queryKey: ['assistant-feed'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
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

  const goalCount = goalsQuery.data?.items?.length ?? 0
  const apiKeyCount = apiKeysQuery.data?.items?.length ?? 0
  const userCount = usersQuery.data?.items?.length ?? 0
  const exportCount = exportsQuery.data?.items?.length ?? 0
  const queuedJobs = runtimeQuery.data?.jobs.queued ?? jobsQuery.data?.items?.filter((job) => job.status === 'queued').length ?? 0
  const runningJobs = runtimeQuery.data?.jobs.running ?? jobsQuery.data?.items?.filter((job) => job.status === 'running').length ?? 0
  const passwordMismatch = Boolean(passwordDraft.next && passwordDraft.confirm && passwordDraft.next !== passwordDraft.confirm)
  const canSubmitPassword = Boolean(passwordDraft.current && passwordDraft.next.length >= 12 && passwordDraft.next === passwordDraft.confirm)
  const hasUnsavedPreference = preferencesQuery.data?.weight_unit !== weightUnitDraft || (preferencesQuery.data?.timezone ?? detectBrowserTimezone()) !== timezoneDraft
  const restoreTone = restoreExport.isError ? 'app-status-danger' : restoreExport.isSuccess ? 'app-status-success' : 'app-status-warning'

  const sectionLinks: SectionLink[] = [
    { id: 'profile', label: 'Profile', note: 'Preferences and goals' },
    { id: 'security', label: 'Security', note: 'Passwords and keys' },
    { id: 'maintenance', label: 'Maintenance', note: 'Backups and jobs' },
    ...(isAdmin ? [{ id: 'admin', label: 'Admin', note: 'Users and coach control' }] : []),
  ]

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[32px] border border-white/10 bg-slate-950/95 p-4 text-canvas shadow-halo backdrop-blur md:p-6">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)] xl:items-start">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.32em] text-amber-300/80">Settings</div>
            <h1 className="mt-3 max-w-3xl font-display text-[2.3rem] leading-none text-canvas sm:text-[3rem]">
              A cleaner control center for quick mobile edits and calmer desktop management.
            </h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300 md:text-base">
              The page is grouped by what people actually need to do: tune personal preferences, handle security, manage backups, and only dive into admin controls when it matters.
            </p>
            <div className="mt-5 rounded-[26px] border border-white/10 bg-white/5 p-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-300">Jump to</div>
              <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                {sectionLinks.map((link) => <SectionLinkChip key={link.id} {...link} />)}
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <HeroMetric label="Account" value={sessionQuery.data?.user?.username ?? 'Local user'} detail={isAdmin ? 'Admin permissions are active for this session.' : 'Member-level controls are visible for this session.'} />
            <HeroMetric label="Units + TZ" value={`${weightUnitDraft.toUpperCase()} | ${timezoneDraft}`} detail={hasUnsavedPreference ? 'You have a preference change ready to save.' : 'Units and local-day timing are already synced.'} />
            <HeroMetric label="Coach Persona" value={runtimeQuery.data?.ai.persona.display_name ?? 'Coach'} detail={runtimeQuery.data ? `${runtimeQuery.data.ai.configured_feature_count} AI feature routes configured.` : 'Runtime details will appear once loaded.'} />
            <HeroMetric label="Jobs" value={`${queuedJobs}/${runningJobs}`} detail="Queued and running background work, surfaced early so maintenance feels less hidden." />
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-8">
          <section className="space-y-4">
            <SectionHeading id="profile" eyebrow="Personal Setup" title="Preferences that affect everyday logging" description="Keep your core habits fast to adjust on a phone: one place for units and the goals that shape nutrition and bodyweight guidance." />

            <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <Panel title="Preferences" subtitle="Choose the units and timezone used across weigh-ins, training loads, summaries, and coach timing." action={<PanelBadge>{hasUnsavedPreference ? 'Unsaved changes' : `${weightUnitDraft.toUpperCase()} active`}</PanelBadge>}>
                <form
                  className="grid gap-4"
                  onSubmit={(event) => {
                    event.preventDefault()
                    updatePreferences.mutate()
                  }}
                >
                  <div className="rounded-[22px] bg-slate-50 p-4 text-sm leading-6 text-slate-600">
                    Keep this aligned with how you think about your bodyweight and lifts so every screen reads naturally. The timezone also controls what counts as "today" for the coach and the morning refresh.
                  </div>

                  <LabelledSelect
                    label="Weight unit"
                    value={weightUnitDraft}
                    onChange={(value) => setWeightUnitDraft(value as 'kg' | 'lbs')}
                    options={[
                      { label: 'Kilograms (kg)', value: 'kg' },
                      { label: 'Pounds (lbs)', value: 'lbs' },
                    ]}
                  />
                  <LabelledInput
                    label="Timezone"
                    value={timezoneDraft}
                    onChange={setTimezoneDraft}
                    placeholder="America/Toronto"
                  />
                  <div className="rounded-[22px] bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">
                    Use an IANA timezone like <code>America/Toronto</code> or <code>America/New_York</code>. Browser default: <strong>{detectBrowserTimezone()}</strong>.
                  </div>

                  {updatePreferences.isError ? <div className="app-status app-status-danger rounded-2xl px-4 py-3 text-sm">{updatePreferences.error.message}</div> : null}
                  {updatePreferences.isSuccess ? <div className="app-status app-status-success rounded-2xl px-4 py-3 text-sm">Preferences updated.</div> : null}

                  <ActionButton type="submit" disabled={updatePreferences.isPending || !hasUnsavedPreference}>
                    Save preferences
                  </ActionButton>
                </form>
              </Panel>

              <Panel title="Goals" subtitle="Targets that drive coach recommendations and progress summaries." action={<PanelBadge>{countLabel(goalCount, 'goal')}</PanelBadge>}>
                <form
                  className="grid gap-3"
                  onSubmit={(event) => {
                    event.preventDefault()
                    createGoal.mutate()
                  }}
                >
                  <LabelledInput label="Goal title" value={goalDraft.title} onChange={(value) => setGoalDraft((current) => ({ ...current, title: value }))} />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <LabelledInput label="Category" value={goalDraft.category} onChange={(value) => setGoalDraft((current) => ({ ...current, category: value }))} />
                    <LabelledInput label="Metric key" value={goalDraft.metric_key} onChange={(value) => setGoalDraft((current) => ({ ...current, metric_key: value }))} />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <LabelledInput label="Target" type="number" value={goalDraft.target_value} onChange={(value) => setGoalDraft((current) => ({ ...current, target_value: value }))} />
                    <LabelledInput label="Unit" value={goalDraft.unit} onChange={(value) => setGoalDraft((current) => ({ ...current, unit: value }))} />
                    <LabelledInput label="Period" value={goalDraft.period} onChange={(value) => setGoalDraft((current) => ({ ...current, period: value }))} />
                  </div>

                  {createGoal.isError ? <div className="app-status app-status-danger rounded-2xl px-4 py-3 text-sm">{createGoal.error.message}</div> : null}
                  {createGoal.isSuccess ? <div className="app-status app-status-success rounded-2xl px-4 py-3 text-sm">Goal saved.</div> : null}

                  <ActionButton type="submit" disabled={createGoal.isPending}>Save goal</ActionButton>
                </form>

                <div className="mt-4 space-y-3">
                  {goalCount ? (
                    (goalsQuery.data?.items ?? []).map((goal) => (
                      <StackCard
                        key={goal.id}
                        title={goal.title}
                        body={`${goal.target_value} ${goal.unit} per ${goal.period}`}
                        meta={`${goal.category} | ${goal.metric_key}`}
                        action={
                          <ActionButton tone="secondary" onClick={() => deleteGoal.mutate(goal.id)} className="w-full sm:w-auto">
                            Delete
                          </ActionButton>
                        }
                      />
                    ))
                  ) : (
                    <EmptyState title="No goals yet" body="Add one or two clear targets so daily guidance has something concrete to steer toward." />
                  )}
                </div>
              </Panel>
            </div>
          </section>

          <section className="space-y-4">
            <SectionHeading id="security" eyebrow="Security & Access" title="Credentials that are easy to manage without feeling risky" description="The most common account and integration actions are grouped together so people can change a password, generate a client token, or manage users without hopping around." />

            <div className="grid gap-4 lg:grid-cols-2">
              <Panel title="Password" subtitle="Change the password for the current signed-in account." action={<PanelBadge>12+ characters</PanelBadge>}>
                <form
                  className="grid gap-3"
                  onSubmit={(event) => {
                    event.preventDefault()
                    changePassword.mutate()
                  }}
                >
                  <LabelledInput label="Current password" type="password" value={passwordDraft.current} onChange={(value) => setPasswordDraft((current) => ({ ...current, current: value }))} />
                  <LabelledInput label="New password" type="password" value={passwordDraft.next} onChange={(value) => setPasswordDraft((current) => ({ ...current, next: value }))} />
                  <LabelledInput label="Confirm password" type="password" value={passwordDraft.confirm} onChange={(value) => setPasswordDraft((current) => ({ ...current, confirm: value }))} />

                  {passwordMismatch ? <div className="app-status app-status-danger rounded-2xl px-4 py-3 text-sm">New passwords do not match.</div> : null}
                  {changePassword.isError ? <div className="app-status app-status-danger rounded-2xl px-4 py-3 text-sm">{changePassword.error.message}</div> : null}
                  {changePassword.isSuccess ? <div className="app-status app-status-success rounded-2xl px-4 py-3 text-sm">Password updated.</div> : null}

                  <ActionButton type="submit" disabled={changePassword.isPending || !canSubmitPassword}>
                    Update password
                  </ActionButton>
                </form>
              </Panel>

              <Panel title="Integration API keys" subtitle="Issue scoped local tokens for trusted clients, scripts, and automations." action={<PanelBadge>{countLabel(apiKeyCount, 'key')}</PanelBadge>}>
                <div className="grid gap-3">
                  <LabelledInput label="Key name" value={apiKeyName} onChange={setApiKeyName} />
                  <LabelledSelect
                    label="Scope preset"
                    value={apiKeyPreset}
                    onChange={(value) => setApiKeyPreset(value as (typeof apiKeyPresets)[number]['value'])}
                    options={apiKeyPresets.map((preset) => ({ label: preset.label, value: preset.value }))}
                  />

                  {createKey.isError ? <div className="app-status app-status-danger rounded-2xl px-4 py-3 text-sm">{createKey.error.message}</div> : null}
                  {createKey.isSuccess ? <div className="app-status app-status-success rounded-2xl px-4 py-3 text-sm">New token created. Copy it while it is visible.</div> : null}

                  <ActionButton onClick={() => createKey.mutate()} disabled={createKey.isPending || !apiKeyName.trim()}>
                    Generate key
                  </ActionButton>
                </div>

                {lastToken ? (
                  <div className="mt-4 rounded-[24px] border border-white/10 bg-slate-950/95 px-4 py-4 text-sm text-canvas">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-amber-300/80">Visible once</div>
                    <div className="mt-2 break-all">{lastToken}</div>
                  </div>
                ) : null}

                <div className="mt-4 space-y-3">
                  {apiKeyCount ? (
                    (apiKeysQuery.data?.items ?? []).map((record) => (
                      <StackCard
                        key={record.id}
                        title={record.name}
                        body={record.prefix}
                        meta={record.scopes.join(', ')}
                        tone="muted"
                        action={
                          <ActionButton tone="secondary" onClick={() => revokeKey.mutate(record.id)} className="w-full sm:w-auto">
                            Revoke
                          </ActionButton>
                        }
                      />
                    ))
                  ) : (
                    <EmptyState title="No API keys yet" body="Generate a scoped token only when you need one for a trusted local integration." />
                  )}
                </div>
              </Panel>
            </div>

            {isAdmin ? (
              <Panel title="Users" subtitle="Create accounts and issue one-time setup links without burying the important shareable details." action={<PanelBadge>{countLabel(userCount, 'managed user')}</PanelBadge>}>
                <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
                  <form
                    className="grid gap-3"
                    onSubmit={(event) => {
                      event.preventDefault()
                      createUser.mutate()
                    }}
                  >
                    <LabelledInput label="Username" value={userDraft.username} onChange={(value) => setUserDraft((current) => ({ ...current, username: value }))} placeholder="alice" />
                    <label className="flex min-h-[52px] items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
                      <input type="checkbox" checked={userDraft.isAdmin} onChange={(event) => setUserDraft((current) => ({ ...current, isAdmin: event.target.checked }))} />
                      Create as admin
                    </label>
                    {createUser.isError ? <div className="app-status app-status-danger rounded-2xl px-4 py-3 text-sm">{createUser.error.message}</div> : null}
                    {issueSetup.isError ? <div className="app-status app-status-danger rounded-2xl px-4 py-3 text-sm">{issueSetup.error.message}</div> : null}
                    <ActionButton type="submit" disabled={!userDraft.username.trim() || createUser.isPending}>Create user</ActionButton>
                  </form>

                  <div className="space-y-3">
                    {setupResult ? (
                      <StackCard
                        tone="inverse"
                        title={resolveSetupUser(setupResult).username}
                        body={resolveSetupUrl(setupResult)}
                        meta={`Token: ${setupResult.setup_token} | Expires ${formatTimestamp(setupResult.setup_expires_at)}`}
                      />
                    ) : null}

                    {userCount ? (
                      (usersQuery.data?.items ?? []).map((user) => (
                        <StackCard
                          key={user.id}
                          title={user.username}
                          body={`${user.is_admin ? 'Admin' : 'User'} | ${user.has_password ? 'Password set' : 'Pending setup'}`}
                          meta={`Created ${formatTimestamp(user.created_at)}`}
                          action={
                            <ActionButton tone="secondary" onClick={() => issueSetup.mutate(user.id)} className="w-full sm:w-auto">
                              Issue link
                            </ActionButton>
                          }
                        />
                      ))
                    ) : (
                      <EmptyState title="No managed users yet" body="Create the first non-admin user and share the setup link so they can choose their own password." />
                    )}
                  </div>
                </div>
              </Panel>
            ) : null}
          </section>

          <section className="space-y-4">
            <SectionHeading id="maintenance" eyebrow="Maintenance" title="Backups and background work that stay easy to inspect" description="Export and restore actions are paired with a live jobs feed, so people can confirm what changed without guessing where the system state lives." />

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)]">
              <Panel title="Exports and restore" subtitle="Create local backups and restore JSON payloads for the current signed-in user scope." action={<PanelBadge>{countLabel(exportCount, 'export')}</PanelBadge>}>
                <div className="rounded-[22px] bg-slate-50 p-4 text-sm leading-6 text-slate-600">
                  Restores affect the signed-in user only, which makes this safer to use from mobile or a shared workstation.
                </div>

                <div className="mt-4 flex flex-wrap gap-3">
                  <ActionButton onClick={() => createExport.mutate()} disabled={createExport.isPending}>Create export</ActionButton>
                </div>

                {createExport.isError ? <div className="app-status app-status-danger mt-4 rounded-2xl px-4 py-3 text-sm">{createExport.error.message}</div> : null}
                {createExport.isSuccess ? <div className="app-status app-status-success mt-4 rounded-2xl px-4 py-3 text-sm">Export created.</div> : null}

                <div className="mt-4 space-y-3">
                  {exportCount ? (
                    (exportsQuery.data?.items ?? []).map((record) => (
                      <StackCard
                        key={record.id}
                        title={record.path}
                        body={formatTimestamp(record.created_at)}
                        action={(
                          <a
                            className="app-button-secondary inline-flex min-h-[48px] w-full items-center justify-center rounded-full px-5 py-3 text-sm font-semibold sm:w-auto"
                            href={`/api/v1/exports/${record.id}/download`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Download
                          </a>
                        )}
                      />
                    ))
                  ) : (
                    <EmptyState title="No exports yet" body="Create a backup before major cleanup, testing, or data imports." />
                  )}

                  {exportsQuery.data?.has_more ? (
                    <ActionButton tone="secondary" onClick={() => setExportLimit((current) => current + 10)} className="w-full sm:w-auto">
                      Load more exports
                    </ActionButton>
                  ) : null}
                </div>

                <div className="mt-5 rounded-[24px] bg-slate-50 p-4">
                  <LabelledTextArea label="Restore JSON" value={restoreText} onChange={setRestoreText} rows={8} placeholder="Paste a FitnessPal export payload here" />
                  <div className="mt-3 flex flex-wrap gap-3">
                    <label className="app-card inline-flex min-h-[48px] cursor-pointer items-center justify-center rounded-full border px-4 py-3 text-sm font-semibold app-text-primary">
                      Load from file
                      <input
                        type="file"
                        accept="application/json"
                        className="hidden"
                        onChange={async (event) => {
                          const file = event.target.files?.[0]
                          if (!file) {
                            return
                          }
                          setRestoreText(await file.text())
                        }}
                      />
                    </label>
                    <ActionButton onClick={handleRestoreSubmit} disabled={restoreExport.isPending || !restoreText.trim()}>
                      Restore export
                    </ActionButton>
                  </div>
                  {restoreStatus ? <div className={`app-status mt-3 rounded-2xl px-4 py-3 text-sm ${restoreTone}`}>{restoreStatus}</div> : null}
                </div>
              </Panel>

              <Panel title="Background jobs" subtitle="Live worker activity for the current user, refreshed every five seconds." action={<PanelBadge>{queuedJobs ? `${queuedJobs} queued` : 'Idle'}</PanelBadge>}>
                <div className="space-y-3">
                  {(jobsQuery.data?.items ?? []).map((job) => (
                    <div key={job.id} className="rounded-[24px] border border-slate-200 bg-white px-4 py-4 text-sm">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-950">{job.job_type}</div>
                          <div className="mt-1 text-slate-500">{job.status} | attempt {job.attempts}/{job.max_attempts}</div>
                        </div>
                        <div className="text-xs uppercase tracking-[0.15em] text-slate-400">{formatTimestamp(job.created_at)}</div>
                      </div>
                      {job.last_error ? <div className="app-status app-status-danger mt-3 rounded-2xl px-3 py-2">{job.last_error}</div> : null}
                    </div>
                  ))}

                  {!jobsQuery.data?.items?.length ? <EmptyState title="No jobs yet" body="As you log meals, upload photos, or trigger backups, the worker queue will appear here." /> : null}

                  {jobsQuery.data?.has_more ? (
                    <ActionButton tone="secondary" onClick={() => setJobLimit((current) => current + 20)} className="w-full sm:w-auto">
                      Load more jobs
                    </ActionButton>
                  ) : null}
                </div>
              </Panel>
            </div>
          </section>

          {isAdmin ? (
            <section className="space-y-4">
              <SectionHeading id="admin" eyebrow="Admin Controls" title="Advanced coach and runtime configuration" description="These tools stay available, but they now sit after the everyday tasks so they do not overwhelm the people who just need to update a few settings quickly." />
              <AiAdminPanel />
            </section>
          ) : null}
        </div>

        <div className="space-y-4 xl:sticky xl:top-4 xl:self-start">
          <Panel title="Snapshot" subtitle="A compact summary that stays useful when the main content gets long.">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <StackCard title={isAdmin ? 'Admin session' : 'Member session'} body={sessionQuery.data?.actor.display_name ?? 'Unknown actor'} meta={sessionQuery.data?.user?.username ?? 'User details unavailable'} tone="muted" />
              <StackCard title={`${apiKeyCount} active keys`} body={`${queuedJobs} queued jobs`} meta={hasUnsavedPreference ? 'A measurement preference is waiting to be saved.' : 'Core preferences are in sync.'} tone="muted" />
              <StackCard title={runtimeQuery.data?.ai.persona.display_name ?? 'Coach persona'} body={runtimeQuery.data ? `${runtimeQuery.data.ai.configured_feature_count} routed AI features` : 'Runtime details loading'} meta={runtimeQuery.data?.ai.legacy_mode ? 'Legacy fallback is active.' : 'Per-feature routing is available.'} tone="muted" />
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

          <Panel title="Runtime" subtitle="Current server, worker, and coach configuration for this user context.">
            {runtimeQuery.data ? (
              <DataList rows={[
                { label: 'App', value: runtimeQuery.data.app_name },
                { label: 'AI profiles', value: isAdmin ? runtimeQuery.data.ai.profiles.length : 'Restricted' },
                { label: 'Configured features', value: runtimeQuery.data.ai.configured_feature_count },
                { label: 'Legacy fallback', value: runtimeQuery.data.ai.legacy_mode ? 'Yes' : 'No' },
                { label: 'Coach persona', value: runtimeQuery.data.ai.persona.display_name },
                { label: 'Queued jobs', value: runtimeQuery.data.jobs.queued },
                { label: 'Running jobs', value: runtimeQuery.data.jobs.running },
                { label: 'Failed jobs', value: runtimeQuery.data.jobs.failed },
                { label: 'Exports root', value: runtimeQuery.data.exports_root },
              ]} />
            ) : (
              <EmptyState title="Runtime unavailable" body="The web app could not fetch server runtime details." />
            )}
          </Panel>
        </div>
      </div>
    </div>
  )
}
