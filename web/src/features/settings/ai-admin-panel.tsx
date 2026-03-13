import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { ActionButton, EmptyState, LabelledInput, LabelledSelect, LabelledTextArea, Panel } from '../../components/ui'
import { api, type AiFeatureBinding, type AiPersonaConfig, type AiProfile } from '../../lib/api'
import { queryClient } from '../../lib/query-client'

type ProfileDraft = {
  name: string
  provider: string
  base_url: string
  description: string
  api_key: string
  clear_api_key: boolean
  replace_default_headers: boolean
  clear_default_headers: boolean
  default_model: string
  timeout_seconds: string
  is_enabled: boolean
  default_headers_json: string
  advanced_settings_json: string
}

type FeatureDraft = {
  profile_id: string
  model: string
  temperature: string
  top_p: string
  max_output_tokens: string
  system_prompt: string
  request_overrides_json: string
}

type PersonaDraft = {
  display_name: string
  tagline: string
  system_prompt: string
  voice_guidelines_json: string
}

const featureGuidance: Record<string, { label: string; description: string }> = {
  meal_photo_estimation: {
    label: 'meal_photo_estimation',
    description: 'Meal-photo estimation. Favor fast vision-capable models.',
  },
  nutrition_label_scan: {
    label: 'nutrition_label_scan',
    description: 'Nutrition-label extraction. Accuracy matters more than style.',
  },
  assistant_quick_capture: {
    label: 'assistant_quick_capture',
    description: 'Draft parsing for natural-language logging.',
  },
  coach_brief: {
    label: 'coach_brief',
    description: 'Daily proactive coach read. Local-first is recommended.',
  },
  coach_advice: {
    label: 'coach_advice',
    description: 'On-demand coach answers. Start local-first, then use cloud only if you need more reasoning depth.',
  },
}

function stringifyJson(value: unknown) {
  return JSON.stringify(value ?? {}, null, 2)
}

function parseJsonValue(text: string, fallback: Record<string, unknown>) {
  if (!text.trim()) {
    return fallback
  }
  return JSON.parse(text) as Record<string, unknown>
}

function toProfileDraft(profile?: AiProfile | null): ProfileDraft {
  return {
    name: profile?.name ?? '',
    provider: profile?.provider ?? 'ollama',
    base_url: profile?.base_url ?? 'http://host.docker.internal:11434',
    description: profile?.description ?? '',
    api_key: '',
    clear_api_key: false,
    replace_default_headers: false,
    clear_default_headers: false,
    default_model: profile?.default_model ?? '',
    timeout_seconds: String(profile?.timeout_seconds ?? 60),
    is_enabled: profile?.is_enabled ?? true,
    default_headers_json: profile?.has_custom_headers ? '' : stringifyJson(profile?.default_headers_json ?? {}),
    advanced_settings_json: stringifyJson(profile?.advanced_settings_json ?? {}),
  }
}

function toFeatureDraft(binding: AiFeatureBinding): FeatureDraft {
  return {
    profile_id: binding.profile_id ?? '',
    model: binding.model ?? '',
    temperature: binding.temperature == null ? '' : String(binding.temperature),
    top_p: binding.top_p == null ? '' : String(binding.top_p),
    max_output_tokens: binding.max_output_tokens == null ? '' : String(binding.max_output_tokens),
    system_prompt: binding.system_prompt ?? '',
    request_overrides_json: stringifyJson(binding.request_overrides_json ?? {}),
  }
}

function toPersonaDraft(persona: AiPersonaConfig): PersonaDraft {
  return {
    display_name: persona.display_name,
    tagline: persona.tagline,
    system_prompt: persona.system_prompt,
    voice_guidelines_json: stringifyJson(persona.voice_guidelines_json ?? {}),
  }
}

export function AiAdminPanel() {
  const profilesQuery = useQuery({ queryKey: ['ai-profiles'], queryFn: api.listAiProfiles })
  const featuresQuery = useQuery({ queryKey: ['ai-features'], queryFn: api.listAiFeatures })
  const personaQuery = useQuery({ queryKey: ['ai-persona'], queryFn: api.getAiPersona })

  const [selectedProfileId, setSelectedProfileId] = useState<string>('new')
  const [profileDraft, setProfileDraft] = useState<ProfileDraft>(toProfileDraft())
  const [featureDrafts, setFeatureDrafts] = useState<Record<string, FeatureDraft>>({})
  const [personaDraft, setPersonaDraft] = useState<PersonaDraft | null>(null)
  const [status, setStatus] = useState('')

  const profiles = profilesQuery.data?.items ?? []
  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId) ?? null

  useEffect(() => {
    if (!profiles.length) {
      setSelectedProfileId('new')
      setProfileDraft(toProfileDraft())
      return
    }
    if (selectedProfileId === 'new') {
      return
    }
    setProfileDraft(toProfileDraft(selectedProfile))
  }, [profiles, selectedProfile, selectedProfileId])

  useEffect(() => {
    const items = featuresQuery.data?.items ?? []
    if (!items.length) return
    setFeatureDrafts((current) => {
      if (Object.keys(current).length) return current
      return Object.fromEntries(items.map((binding) => [binding.feature_key, toFeatureDraft(binding)]))
    })
  }, [featuresQuery.data?.items])

  useEffect(() => {
    if (personaQuery.data?.persona && !personaDraft) {
      setPersonaDraft(toPersonaDraft(personaQuery.data.persona))
    }
  }, [personaDraft, personaQuery.data?.persona])

  const invalidateAiQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['ai-profiles'] }),
      queryClient.invalidateQueries({ queryKey: ['ai-features'] }),
      queryClient.invalidateQueries({ queryKey: ['ai-persona'] }),
      queryClient.invalidateQueries({ queryKey: ['runtime'] }),
      queryClient.invalidateQueries({ queryKey: ['assistant-feed'] }),
      queryClient.invalidateQueries({ queryKey: ['assistant-brief'] }),
    ])
  }

  const saveProfile = useMutation({
    mutationFn: async () => {
      const payload = {
        name: profileDraft.name,
        provider: profileDraft.provider,
        base_url: profileDraft.base_url,
        description: profileDraft.description || null,
        api_key: profileDraft.api_key || null,
        clear_api_key: profileDraft.clear_api_key,
        clear_default_headers: profileDraft.clear_default_headers,
        default_model: profileDraft.default_model || null,
        timeout_seconds: Number(profileDraft.timeout_seconds || 60),
        is_enabled: profileDraft.is_enabled,
        advanced_settings_json: parseJsonValue(profileDraft.advanced_settings_json, {}),
      } as Record<string, unknown>
      if (!selectedProfile || !selectedProfile.has_custom_headers || profileDraft.replace_default_headers) {
        payload.default_headers_json = parseJsonValue(profileDraft.default_headers_json, {})
      }
      if (selectedProfile && !selectedProfile.is_read_only) {
        return api.updateAiProfile(selectedProfile.id, payload)
      }
      return api.createAiProfile(payload)
    },
    onSuccess: async (result) => {
      setStatus(`Saved AI profile ${result.name}.`)
      setSelectedProfileId(result.id)
      setProfileDraft((current) => ({
        ...current,
        api_key: '',
        clear_api_key: false,
        clear_default_headers: false,
        replace_default_headers: false,
        default_headers_json: result.has_custom_headers ? '' : current.default_headers_json,
      }))
      await invalidateAiQueries()
    },
    onError: (error) => setStatus(error.message),
  })

  const deleteProfile = useMutation({
    mutationFn: (profileId: string) => api.deleteAiProfile(profileId),
    onSuccess: async () => {
      setSelectedProfileId('new')
      setProfileDraft(toProfileDraft())
      setStatus('Deleted AI profile.')
      await invalidateAiQueries()
    },
    onError: (error) => setStatus(error.message),
  })

  const testProfile = useMutation({
    mutationFn: (profileId: string) => api.testAiProfile(profileId),
    onSuccess: (result) => {
      setStatus(result.reachable ? `Profile test passed. ${result.available_models.length} model(s) visible.` : (result.error ?? 'Profile test failed.'))
    },
    onError: (error) => setStatus(error.message),
  })

  const refreshModels = useMutation({
    mutationFn: (profileId: string) => api.refreshAiProfileModels(profileId),
    onSuccess: async (result) => {
      setStatus(`Refreshed models for ${result.name}.`)
      await invalidateAiQueries()
    },
    onError: (error) => setStatus(error.message),
  })

  const saveFeatures = useMutation({
    mutationFn: () => api.updateAiFeatures(
      Object.entries(featureDrafts).map(([feature_key, draft]) => ({
        feature_key,
        profile_id: draft.profile_id || null,
        model: draft.model || null,
        temperature: draft.temperature === '' ? null : Number(draft.temperature),
        top_p: draft.top_p === '' ? null : Number(draft.top_p),
        max_output_tokens: draft.max_output_tokens === '' ? null : Number(draft.max_output_tokens),
        system_prompt: draft.system_prompt || null,
        request_overrides_json: parseJsonValue(draft.request_overrides_json, {}),
      })),
    ),
    onSuccess: async () => {
      setStatus('Saved feature routing.')
      await invalidateAiQueries()
    },
    onError: (error) => setStatus(error.message),
  })

  const savePersona = useMutation({
    mutationFn: () => {
      if (!personaDraft) {
        throw new Error('Persona draft is not ready yet.')
      }
      return api.updateAiPersona({
        display_name: personaDraft.display_name,
        tagline: personaDraft.tagline,
        system_prompt: personaDraft.system_prompt,
        voice_guidelines_json: parseJsonValue(personaDraft.voice_guidelines_json, {}),
      })
    },
    onSuccess: async ({ persona }) => {
      setPersonaDraft(toPersonaDraft(persona))
      setStatus(`Updated coach persona to ${persona.display_name}.`)
      await invalidateAiQueries()
    },
    onError: (error) => setStatus(error.message),
  })

  const profileOptions = [
    { label: 'Unassigned', value: '' },
    ...profiles.map((profile) => ({ label: `${profile.name} (${profile.provider})`, value: profile.id })),
  ]

  return (
    <div className="space-y-4">
      <Panel title="Coach Control" subtitle="Provider profiles, feature routing, and persona settings for the in-app AI coach.">
        {status ? <div className="app-status app-status-warning mb-4 rounded-2xl px-4 py-3 text-sm">{status}</div> : null}
        <div className="mb-4 rounded-2xl bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">
          Cloud API keys are stored encrypted. Set <code>FITNESSPAL_CONFIG_SECRET</code> on the server before saving OpenAI or Anthropic credentials.
        </div>
        <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
          <div className="space-y-3">
            <ActionButton tone="secondary" className="w-full" onClick={() => { setSelectedProfileId('new'); setProfileDraft(toProfileDraft()) }}>New profile</ActionButton>
            {profiles.map((profile) => (
              <button
                key={profile.id}
                type="button"
                className={`w-full rounded-[22px] border px-4 py-4 text-left text-sm ${selectedProfileId === profile.id ? 'border-amber-400 bg-amber-50' : 'border-slate-200 bg-white'}`}
                onClick={() => {
                  setSelectedProfileId(profile.id)
                  setProfileDraft(toProfileDraft(profile))
                }}
              >
                <div className="font-semibold text-slate-950">{profile.name}</div>
                <div className="mt-1 text-slate-500">{profile.provider} - {profile.default_model || 'Model set per feature'}</div>
                <div className="mt-2 text-xs text-slate-400">{profile.is_read_only ? 'Legacy fallback' : (profile.last_reachable ? 'Reachable' : 'Not tested')}</div>
              </button>
            ))}
            {!profiles.length ? <EmptyState title="No AI profiles yet" body="Create the first provider profile, then map features to it below." /> : null}
          </div>

          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              saveProfile.mutate()
            }}
          >
            <div className="grid gap-3 md:grid-cols-2">
              <LabelledInput label="Profile name" value={profileDraft.name} onChange={(value) => setProfileDraft((current) => ({ ...current, name: value }))} />
              <LabelledSelect
                label="Provider"
                value={profileDraft.provider}
                onChange={(value) => setProfileDraft((current) => ({ ...current, provider: value }))}
                options={[
                  { label: 'Ollama local', value: 'ollama' },
                  { label: 'OpenAI API', value: 'openai' },
                  { label: 'Anthropic API', value: 'anthropic' },
                ]}
              />
            </div>
            <LabelledInput label="Base URL" value={profileDraft.base_url} onChange={(value) => setProfileDraft((current) => ({ ...current, base_url: value }))} />
            <div className="grid gap-3 md:grid-cols-2">
              <LabelledInput label="Default model" value={profileDraft.default_model} onChange={(value) => setProfileDraft((current) => ({ ...current, default_model: value }))} />
              <LabelledInput label="Timeout seconds" type="number" value={profileDraft.timeout_seconds} onChange={(value) => setProfileDraft((current) => ({ ...current, timeout_seconds: value }))} />
            </div>
            <LabelledInput label="Description" value={profileDraft.description} onChange={(value) => setProfileDraft((current) => ({ ...current, description: value }))} />
            <LabelledInput label="API key" type="password" value={profileDraft.api_key} onChange={(value) => setProfileDraft((current) => ({ ...current, api_key: value }))} placeholder={selectedProfile?.has_api_key ? 'Stored key present; enter a new one to replace it' : 'Optional for Ollama or local proxies'} />
            <label className="flex items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
              <input type="checkbox" checked={profileDraft.clear_api_key} onChange={(event) => setProfileDraft((current) => ({ ...current, clear_api_key: event.target.checked }))} />
              Clear stored API key
            </label>
            {selectedProfile?.has_custom_headers ? (
              <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700">
                Stored custom headers are hidden and stay unchanged unless you replace or clear them.
                {selectedProfile.custom_header_keys.length ? ` Keys: ${selectedProfile.custom_header_keys.join(', ')}` : ''}
              </div>
            ) : null}
            <label className="flex items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={profileDraft.replace_default_headers}
                onChange={(event) => setProfileDraft((current) => ({
                  ...current,
                  replace_default_headers: event.target.checked,
                  clear_default_headers: event.target.checked ? false : current.clear_default_headers,
                }))}
                disabled={profileDraft.clear_default_headers}
              />
              Replace stored custom headers
            </label>
            <label className="flex items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={profileDraft.clear_default_headers}
                onChange={(event) => setProfileDraft((current) => ({
                  ...current,
                  clear_default_headers: event.target.checked,
                  replace_default_headers: event.target.checked ? false : current.replace_default_headers,
                }))}
              />
              Clear stored custom headers
            </label>
            <label className="flex items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
              <input type="checkbox" checked={profileDraft.is_enabled} onChange={(event) => setProfileDraft((current) => ({ ...current, is_enabled: event.target.checked }))} />
              Profile enabled
            </label>
            <LabelledTextArea
              label="Default headers JSON"
              value={profileDraft.default_headers_json}
              onChange={(value) => setProfileDraft((current) => ({ ...current, default_headers_json: value }))}
              rows={5}
              placeholder={selectedProfile?.has_custom_headers && !profileDraft.replace_default_headers ? 'Enable "Replace stored custom headers" to overwrite the existing hidden values.' : '{\n  "X-Proxy-Key": "value"\n}'}
            />
            <LabelledTextArea label="Advanced settings JSON" value={profileDraft.advanced_settings_json} onChange={(value) => setProfileDraft((current) => ({ ...current, advanced_settings_json: value }))} rows={7} />
            <div className="flex flex-wrap gap-2">
              <ActionButton type="submit" disabled={saveProfile.isPending || (selectedProfile?.is_read_only ?? false)}>{selectedProfile && !selectedProfile.is_read_only ? 'Save profile' : 'Create profile'}</ActionButton>
              {selectedProfile ? <ActionButton tone="secondary" onClick={() => testProfile.mutate(selectedProfile.id)} disabled={testProfile.isPending}>Test profile</ActionButton> : null}
              {selectedProfile ? <ActionButton tone="secondary" onClick={() => refreshModels.mutate(selectedProfile.id)} disabled={refreshModels.isPending}>Refresh models</ActionButton> : null}
              {selectedProfile && !selectedProfile.is_read_only ? <ActionButton tone="secondary" onClick={() => deleteProfile.mutate(selectedProfile.id)} disabled={deleteProfile.isPending}>Delete profile</ActionButton> : null}
            </div>
          </form>
        </div>
      </Panel>

      <Panel title="Feature Routing" subtitle="Choose which backend handles each AI feature, plus optional per-feature overrides. The coach surfaces are designed to work well on local models first.">
        <div className="space-y-4">
          {(featuresQuery.data?.items ?? []).map((binding) => {
            const draft = featureDrafts[binding.feature_key] ?? toFeatureDraft(binding)
            const guidance = featureGuidance[binding.feature_key] ?? { label: binding.feature_key, description: 'Explicit per-feature AI routing.' }
            return (
              <div key={binding.feature_key} className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold text-slate-950">{guidance.label}</div>
                    <div className="mt-1 text-sm text-slate-500">{binding.uses_legacy_fallback ? 'Using legacy fallback until a saved profile is assigned.' : guidance.description}</div>
                  </div>
                  <div className="rounded-full bg-white px-3 py-1 text-xs text-slate-500">{binding.profile?.name ?? 'Unassigned'}</div>
                </div>
                <div className="grid gap-3 lg:grid-cols-2">
                  <LabelledSelect label="Profile" value={draft.profile_id} onChange={(value) => setFeatureDrafts((current) => ({ ...current, [binding.feature_key]: { ...draft, profile_id: value } }))} options={profileOptions} />
                  <LabelledInput label="Model override" value={draft.model} onChange={(value) => setFeatureDrafts((current) => ({ ...current, [binding.feature_key]: { ...draft, model: value } }))} />
                  <LabelledInput label="Temperature" type="number" step="0.05" value={draft.temperature} onChange={(value) => setFeatureDrafts((current) => ({ ...current, [binding.feature_key]: { ...draft, temperature: value } }))} />
                  <LabelledInput label="Top p" type="number" step="0.05" value={draft.top_p} onChange={(value) => setFeatureDrafts((current) => ({ ...current, [binding.feature_key]: { ...draft, top_p: value } }))} />
                  <LabelledInput label="Max output tokens" type="number" value={draft.max_output_tokens} onChange={(value) => setFeatureDrafts((current) => ({ ...current, [binding.feature_key]: { ...draft, max_output_tokens: value } }))} />
                  <LabelledInput label="System prompt override" value={draft.system_prompt} onChange={(value) => setFeatureDrafts((current) => ({ ...current, [binding.feature_key]: { ...draft, system_prompt: value } }))} />
                </div>
                <div className="mt-3">
                  <LabelledTextArea label="Request overrides JSON" value={draft.request_overrides_json} onChange={(value) => setFeatureDrafts((current) => ({ ...current, [binding.feature_key]: { ...draft, request_overrides_json: value } }))} rows={5} />
                </div>
              </div>
            )
          })}
        </div>
        <div className="mt-4">
          <ActionButton onClick={() => saveFeatures.mutate()} disabled={saveFeatures.isPending}>Save feature routing</ActionButton>
        </div>
      </Panel>

      <Panel title="Coach Persona" subtitle="Brand the assistant voice that appears in the dashboard and Coach page.">
        {!personaDraft ? (
          <EmptyState title="Persona loading" body="The default coach persona will appear here once the runtime response arrives." />
        ) : (
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              savePersona.mutate()
            }}
          >
            <div className="grid gap-3 md:grid-cols-2">
              <LabelledInput label="Display name" value={personaDraft.display_name} onChange={(value) => setPersonaDraft((current) => current ? { ...current, display_name: value } : current)} />
              <LabelledInput label="Tagline" value={personaDraft.tagline} onChange={(value) => setPersonaDraft((current) => current ? { ...current, tagline: value } : current)} />
            </div>
            <LabelledTextArea label="System prompt" value={personaDraft.system_prompt} onChange={(value) => setPersonaDraft((current) => current ? { ...current, system_prompt: value } : current)} rows={6} />
            <LabelledTextArea label="Voice guidelines JSON" value={personaDraft.voice_guidelines_json} onChange={(value) => setPersonaDraft((current) => current ? { ...current, voice_guidelines_json: value } : current)} rows={5} />
            <ActionButton type="submit" disabled={savePersona.isPending}>Save coach persona</ActionButton>
          </form>
        )}
      </Panel>
    </div>
  )
}

