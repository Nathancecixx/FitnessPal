import {
  cacheApiResponse,
  enqueueSyncRequest,
  getSyncState,
  listQueuedSyncRequests,
  markSyncFlushComplete,
  readCachedApiResponse,
  removeQueuedSyncRequest,
  setSyncFlushing,
  type QueuedSyncRequest,
} from './offline'
import { queryClient } from './query-client'
import type { WeightUnit } from './weight-units'

export type DashboardCard = {
  key: string
  title: string
  route: string
  description: string
  accent: string
  priority: number
  value?: string | number | null
  detail?: string | null
  trend?: number | null
  status?: string
}

export type PagedListResponse<T> = {
  items: T[]
  total: number
  limit?: number
  has_more?: boolean
  next_cursor?: string | null
  requested_by?: string
}

export type CursorListParams = {
  limit?: number
  cursor?: string | null
}

export type DateRangeListParams = CursorListParams & {
  date_from?: string
  date_to?: string
}

export type SyncMeta = {
  sync_status?: 'queued'
  queued_at?: string | null
}

export type MacroTotals = {
  calories: number
  protein_g: number
  carbs_g: number
  fat_g: number
  fiber_g: number
  sodium_mg: number
}

export type FoodItem = {
  id: string
  name: string
  brand?: string | null
  serving_name?: string | null
  calories: number
  protein_g: number
  carbs_g: number
  fat_g: number
  fiber_g: number
  sugar_g?: number
  sodium_mg: number
  notes?: string | null
  is_favorite?: boolean
  tags_json: string[]
}

export type FoodImportDraft = {
  source: string
  barcode?: string
  provider?: string
  model_name?: string
  food: Omit<FoodItem, 'id' | 'tags_json'> & { notes?: string | null }
}

export type Recipe = {
  id: string
  name: string
  servings: number
  instructions_json: string[]
  notes?: string | null
  tags_json: string[]
  items: Array<{
    id: string
    food_id: string
    food_name: string
    grams: number
    macros: MacroTotals
  }>
  per_serving: MacroTotals
  created_at: string
}

export type MealEntryItem = {
  id?: string
  food_id?: string | null
  label: string
  grams?: number | null
  calories: number
  protein_g: number
  carbs_g: number
  fat_g: number
  fiber_g?: number
  sodium_mg?: number
  source_type: string
}

export type MealEntry = {
  id: string
  logged_at: string
  meal_type: string
  source: string
  notes?: string | null
  tags_json: string[]
  totals: MacroTotals
  ai_confidence?: number | null
  items: MealEntryItem[]
}

export type MealTemplate = {
  id: string
  name: string
  meal_type: string
  notes?: string | null
  tags_json: string[]
  totals: MacroTotals
  items: MealEntryItem[]
}

export type MealPhotoDraft = {
  id: string
  status: string
  source_path?: string | null
  file_name?: string
  provider?: string | null
  model_name?: string | null
  confidence?: number | null
  candidates: MealEntryItem[]
  error_message?: string | null
  meal_entry_id?: string | null
  created_at: string
}

export type Exercise = {
  id: string
  name: string
  category: string
  movement_pattern?: string | null
  equipment?: string | null
  rep_target_min: number
  rep_target_max: number
  load_increment: number
}

export type Routine = {
  id: string
  name: string
  goal?: string | null
  schedule_notes?: string | null
  notes?: string | null
  items: Array<{
    id: string
    exercise_id: string
    exercise_name?: string | null
    day_label: string
    order_index: number
    target_sets: number
    target_reps_min: number
    target_reps_max: number
    target_rir?: number | null
  }>
  created_at: string
}

export type WorkoutSet = {
  id?: string
  exercise_id: string
  set_index: number
  reps: number
  load_kg: number
  rir?: number | null
  rpe?: number | null
  is_warmup?: boolean
  progression_label?: string | null
  is_pr?: boolean
}

export type WorkoutTemplate = {
  id: string
  name: string
  routine_id?: string | null
  notes?: string | null
  items: Array<{
    id: string
    exercise_id: string
    exercise_name?: string | null
    order_index: number
    target_sets: number
    target_reps_min: number
    target_reps_max: number
    rest_seconds: number
    target_rir?: number | null
  }>
}

export type WorkoutSession = {
  id: string
  template_id?: string | null
  routine_id?: string | null
  started_at: string
  ended_at?: string | null
  notes?: string | null
  perceived_energy?: number | null
  bodyweight_kg?: number | null
  total_volume_kg: number
  total_sets: number
  sets: WorkoutSet[]
}

export type WeightEntry = {
  id: string
  logged_at: string
  weight_kg: number
  body_fat_pct?: number | null
  waist_cm?: number | null
  notes?: string | null
}

export type WeightTrendPoint = {
  logged_at: string
  weight_kg: number
  trend_7: number
  trend_30: number
}

export type InsightSnapshot = {
  id: string
  snapshot_date: string
  source: string
  created_at: string
  payload: {
    nutrition: {
      daily_calories: Record<string, number>
      average_calories_7: number
      goal_calories?: number | null
      adherence_ratio?: number | null
    }
    body: {
      latest_weight_kg?: number | null
      weight_trend_kg_per_week: number
      trend_7: number[]
      trend_30: number[]
    }
    training: {
      weekly_volume_kg: number
      volume_delta_kg: number
      session_count_7: number
      last_session_at?: string | null
      pr_count: number
    }
    recovery_flags: string[]
    recommendations: string[]
    generated_at: string
  }
}

export type InsightSummary = InsightSnapshot['payload'] & {
  window_days?: number
}

export type Goal = {
  id: string
  category: string
  title: string
  metric_key: string
  target_value: number
  unit: string
  period: string
  notes?: string | null
  created_at: string
}

export type ApiKeyRecord = {
  id: string
  name: string
  prefix: string
  scopes: string[]
  created_at?: string
  last_used_at?: string | null
  token?: string
}

export type AiProfile = {
  id: string
  name: string
  provider: string
  description?: string | null
  base_url: string
  default_model?: string | null
  timeout_seconds: number
  is_enabled: boolean
  is_read_only: boolean
  default_headers_json: Record<string, string>
  custom_header_keys: string[]
  has_custom_headers: boolean
  advanced_settings_json: Record<string, unknown>
  models_json: string[]
  last_reachable: boolean
  last_tested_at?: string | null
  last_error?: string | null
  source: string
  has_api_key: boolean
}

export type AiFeatureBinding = {
  id: string
  feature_key: string
  profile_id?: string | null
  profile?: AiProfile | null
  model?: string | null
  temperature?: number | null
  top_p?: number | null
  max_output_tokens?: number | null
  system_prompt?: string | null
  request_overrides_json: Record<string, unknown>
  uses_legacy_fallback: boolean
  updated_at: string
}

export type AiPersonaConfig = {
  id: string
  config_key: string
  display_name: string
  tagline: string
  system_prompt: string
  voice_guidelines_json: Record<string, unknown>
  updated_at: string
}

export type AiPersonaSummary = {
  id: string
  config_key: string
  display_name: string
  tagline: string
  updated_at: string
}

export type ManagedUser = {
  id: string
  username: string
  is_admin: boolean
  is_active: boolean
  has_password: boolean
  password_set_at?: string | null
  created_at: string
}

export type AuthResponse = {
  user: ManagedUser
  scopes: string[]
}

export type SessionInfo = {
  actor: {
    id: string
    type: string
    display_name: string
    scopes: string[]
  }
  user: ManagedUser | null
}

export type UserPreferences = {
  weight_unit: WeightUnit
  created_at?: string | null
  updated_at?: string | null
}

export type UserSetupResponse = {
  user?: ManagedUser
  id?: string
  username?: string
  is_admin?: boolean
  is_active?: boolean
  has_password?: boolean
  password_set_at?: string | null
  created_at?: string
  setup_token: string
  setup_expires_at: string
  setup_path: string
}

export type ExportRecord = {
  id: string
  format: string
  status: string
  path: string
  summary: Record<string, number>
  created_at: string
  finished_at?: string | null
}

export type JobRecord = {
  id: string
  job_type: string
  status: string
  payload?: Record<string, unknown>
  result?: Record<string, unknown> | null
  dedupe_key?: string | null
  attempts: number
  max_attempts: number
  available_at: string
  claimed_at?: string | null
  finished_at?: string | null
  last_error?: string | null
  created_at: string
}

export type RuntimeInfo = {
  app_name: string
  api_prefix: string
  storage_root: string
  uploads_root: string
  exports_root: string
  allow_origins: string[]
  ai: {
    profiles: AiProfile[]
    features: AiFeatureBinding[]
    persona: AiPersonaSummary
    legacy_mode: boolean
    configured_feature_count: number
  }
  jobs: {
    queued: number
    running: number
    failed: number
  }
  last_export_at?: string | null
  requested_by: string
}

export type AssistantDraft =
  | {
      kind: 'meal_entry'
      summary: string
      payload: {
        meal_type: string
        notes?: string
        source?: string
        items: MealEntryItem[]
      }
    }
  | {
      kind: 'weight_entry'
      summary: string
      payload: {
        weight_kg: number
        body_fat_pct?: number | null
        waist_cm?: number | null
        notes?: string
      }
    }
  | {
      kind: 'workout_session'
      summary: string
      payload: {
        notes?: string
        exercise_name?: string
        sets: Array<{
          exercise_id?: string
          exercise_label?: string
          set_index: number
          reps: number
          load_kg: number
          rir?: number | null
        }>
      }
    }

export type AssistantDraftResponse = {
  drafts: AssistantDraft[]
  warnings: string[]
  provider?: string
  model_name?: string
}

export type AssistantBrief = {
  id: string
  status: string
  source: string
  provider?: string | null
  model_name?: string | null
  title: string
  summary: string
  body_markdown?: string | null
  actions: string[]
  stats: Record<string, string | number>
  error_message?: string | null
  persona_name: string
  persona_tagline: string
  created_at: string
  updated_at: string
}

export type AssistantCoachAdvice = {
  source: string
  provider?: string | null
  model_name?: string | null
  question: string
  title: string
  summary: string
  body_markdown?: string | null
  actions: string[]
  watchouts: string[]
  focus_area: string
  follow_up_prompt?: string | null
  stats: Record<string, string | number | null>
  generated_at: string
}

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api/v1'
const IMAGE_RESIZE_THRESHOLD_BYTES = 4 * 1024 * 1024
const IMAGE_UPLOAD_MAX_EDGE = 2048
const IMAGE_UPLOAD_QUALITY = 0.82
let outboxProcessorInitialized = false

async function readErrorMessage(response: Response): Promise<string> {
  const errorBody = await response.text()

  if (response.status === 413) {
    return 'Upload too large. Please try a smaller image or photo.'
  }

  try {
    const parsed = JSON.parse(errorBody) as { detail?: string }
    if (parsed.detail) {
      return parsed.detail
    }
  } catch {
    // Fall through to plain-text handling.
  }

  const plainText = errorBody.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  return plainText || `Request failed with ${response.status}`
}

async function loadImageElement(file: File): Promise<HTMLImageElement> {
  const objectUrl = URL.createObjectURL(file)
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(objectUrl)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('Image decode failed'))
    }
    image.src = objectUrl
  })
}

async function prepareImageUpload(file: File): Promise<File> {
  if (
    typeof document === 'undefined'
    || !file.type.startsWith('image/')
    || file.type === 'image/gif'
    || file.type === 'image/svg+xml'
    || file.size <= IMAGE_RESIZE_THRESHOLD_BYTES
  ) {
    return file
  }

  try {
    const image = await loadImageElement(file)
    const longestEdge = Math.max(image.naturalWidth, image.naturalHeight)
    const scale = longestEdge > IMAGE_UPLOAD_MAX_EDGE ? IMAGE_UPLOAD_MAX_EDGE / longestEdge : 1
    const width = Math.max(1, Math.round(image.naturalWidth * scale))
    const height = Math.max(1, Math.round(image.naturalHeight * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) {
      return file
    }

    context.drawImage(image, 0, 0, width, height)

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', IMAGE_UPLOAD_QUALITY)
    })
    if (!blob || blob.size >= file.size) {
      return file
    }

    const baseName = file.name.replace(/\.[^.]+$/, '') || 'upload'
    return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg', lastModified: file.lastModified })
  } catch {
    return file
  }
}

function buildQueryString(params: Record<string, string | number | boolean | null | undefined>) {
  const searchParams = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return
    }
    searchParams.set(key, String(value))
  })
  const queryString = searchParams.toString()
  return queryString ? `?${queryString}` : ''
}

function buildCacheKey(path: string, method: string) {
  return `${method.toUpperCase()}:${path}`
}

function isNetworkError(error: unknown) {
  return error instanceof TypeError || (error instanceof Error && /fetch|network|offline/i.test(error.message))
}

function buildSyncId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function buildIdempotencyKey(prefix: string) {
  return `fitnesspal-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function updatePagedCache<T extends { id: string }>(queryKey: readonly unknown[], item: T) {
  queryClient.setQueryData<PagedListResponse<T> | undefined>(queryKey, (current) => {
    if (!current) {
      return {
        items: [item],
        total: 1,
        has_more: false,
        next_cursor: null,
      }
    }

    const items = [item, ...current.items.filter((entry) => entry.id !== item.id)]
    return {
      ...current,
      items,
      total: items.length,
    }
  })
}

function invalidateQueuedPath(path: string) {
  if (path.startsWith('/meals')) {
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ['meals'] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      queryClient.invalidateQueries({ queryKey: ['insights'] }),
      queryClient.invalidateQueries({ queryKey: ['insights-summary'] }),
      queryClient.invalidateQueries({ queryKey: ['assistant-brief'] }),
    ])
    return
  }

  if (path.startsWith('/workout-sessions')) {
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ['workout-sessions'] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      queryClient.invalidateQueries({ queryKey: ['insights'] }),
      queryClient.invalidateQueries({ queryKey: ['insights-summary'] }),
      queryClient.invalidateQueries({ queryKey: ['assistant-brief'] }),
    ])
    return
  }

  if (path.startsWith('/weight-entries')) {
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ['weight-entries'] }),
      queryClient.invalidateQueries({ queryKey: ['weight-trends'] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      queryClient.invalidateQueries({ queryKey: ['insights'] }),
      queryClient.invalidateQueries({ queryKey: ['insights-summary'] }),
      queryClient.invalidateQueries({ queryKey: ['assistant-brief'] }),
    ])
  }
}

function buildQueuedMealEntry(id: string, queuedAt: string, payload: Record<string, unknown>): MealEntry & SyncMeta {
  const items = Array.isArray(payload.items) ? payload.items as MealEntryItem[] : []
  const totals = items.reduce<MacroTotals>((current, item) => ({
    calories: current.calories + Number(item.calories ?? 0),
    protein_g: current.protein_g + Number(item.protein_g ?? 0),
    carbs_g: current.carbs_g + Number(item.carbs_g ?? 0),
    fat_g: current.fat_g + Number(item.fat_g ?? 0),
    fiber_g: current.fiber_g + Number(item.fiber_g ?? 0),
    sodium_mg: current.sodium_mg + Number(item.sodium_mg ?? 0),
  }), {
    calories: 0,
    protein_g: 0,
    carbs_g: 0,
    fat_g: 0,
    fiber_g: 0,
    sodium_mg: 0,
  })

  return {
    id,
    logged_at: typeof payload.logged_at === 'string' ? payload.logged_at : queuedAt,
    meal_type: typeof payload.meal_type === 'string' ? payload.meal_type : 'meal',
    source: typeof payload.source === 'string' ? payload.source : 'manual',
    notes: typeof payload.notes === 'string' ? payload.notes : null,
    tags_json: Array.isArray(payload.tags_json) ? payload.tags_json as string[] : [],
    totals,
    ai_confidence: null,
    items,
    sync_status: 'queued',
    queued_at: queuedAt,
  }
}

function buildQueuedWorkoutSession(id: string, queuedAt: string, payload: Record<string, unknown>): WorkoutSession & SyncMeta {
  const sets = Array.isArray(payload.sets) ? payload.sets as WorkoutSet[] : []
  return {
    id,
    template_id: typeof payload.template_id === 'string' ? payload.template_id : null,
    routine_id: typeof payload.routine_id === 'string' ? payload.routine_id : null,
    started_at: typeof payload.started_at === 'string' ? payload.started_at : queuedAt,
    ended_at: typeof payload.ended_at === 'string' ? payload.ended_at : null,
    notes: typeof payload.notes === 'string' ? payload.notes : null,
    perceived_energy: typeof payload.perceived_energy === 'number' ? payload.perceived_energy : null,
    bodyweight_kg: typeof payload.bodyweight_kg === 'number' ? payload.bodyweight_kg : null,
    total_volume_kg: sets.reduce((sum, set) => sum + (Number(set.load_kg ?? 0) * Number(set.reps ?? 0)), 0),
    total_sets: sets.length,
    sets,
    sync_status: 'queued',
    queued_at: queuedAt,
  }
}

function buildQueuedWeightEntry(id: string, queuedAt: string, payload: Record<string, unknown>): WeightEntry & SyncMeta {
  return {
    id,
    logged_at: typeof payload.logged_at === 'string' ? payload.logged_at : queuedAt,
    weight_kg: Number(payload.weight_kg ?? 0),
    body_fat_pct: payload.body_fat_pct == null ? null : Number(payload.body_fat_pct),
    waist_cm: payload.waist_cm == null ? null : Number(payload.waist_cm),
    notes: typeof payload.notes === 'string' ? payload.notes : null,
    sync_status: 'queued',
    queued_at: queuedAt,
  }
}

async function performQueuedRequest(request: QueuedSyncRequest) {
  const response = await fetch(`${API_BASE}${request.path}`, {
    method: request.method,
    credentials: 'include',
    headers: request.headers,
    body: request.body,
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }
}

export async function flushQueuedWrites() {
  if (typeof window === 'undefined' || !window.navigator.onLine || getSyncState().queuedCount === 0 || getSyncState().isFlushing) {
    return
  }

  setSyncFlushing(true)
  try {
    for (const queuedRequest of listQueuedSyncRequests()) {
      try {
        await performQueuedRequest(queuedRequest)
        removeQueuedSyncRequest(queuedRequest.id)
        invalidateQueuedPath(queuedRequest.path)
      } catch (error) {
        if (isNetworkError(error)) {
          break
        }
        throw error
      }
    }
    markSyncFlushComplete(new Date().toISOString())
  } finally {
    setSyncFlushing(false)
  }
}

function ensureOutboxProcessor() {
  if (outboxProcessorInitialized || typeof window === 'undefined') {
    return
  }

  outboxProcessorInitialized = true
  window.addEventListener('online', () => {
    void flushQueuedWrites()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && window.navigator.onLine) {
      void flushQueuedWrites()
    }
  })
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers ?? {})
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const method = init?.method?.toUpperCase() ?? 'GET'
  const cacheKey = buildCacheKey(path, method)
  let response: Response

  try {
    response = await fetch(`${API_BASE}${path}`, {
      credentials: 'include',
      ...init,
      headers,
    })
  } catch (error) {
    if (method === 'GET') {
      const cached = readCachedApiResponse<T>(cacheKey)
      if (cached !== null) {
        return cached
      }
    }
    throw error
  }

  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }

  const payload = await response.json() as T
  if (method === 'GET') {
    cacheApiResponse(cacheKey, payload)
  }
  return payload
}

async function upload<T>(path: string, formData: FormData): Promise<T> {
  if (typeof window !== 'undefined' && !window.navigator.onLine) {
    throw new Error('Uploads require a connection. Please retry when you are back online.')
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }

  return response.json() as Promise<T>
}

async function queueableCreate<T extends { id: string }>(
  path: string,
  payload: Record<string, unknown>,
  buildPlaceholder: (id: string, queuedAt: string, payload: Record<string, unknown>) => T,
  queryKey: readonly unknown[],
) {
  const idempotencyKey = buildIdempotencyKey(path.replaceAll('/', '-'))
  try {
    return await request<T>(path, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(payload),
    })
  } catch (error) {
    if (typeof window === 'undefined' || (window.navigator.onLine && !isNetworkError(error))) {
      throw error
    }

    const queuedAt = new Date().toISOString()
    const queuedId = buildSyncId(path.replaceAll('/', '').replaceAll('-', '') || 'queued')
    enqueueSyncRequest({
      id: queuedId,
      method: 'POST',
      path,
      body: JSON.stringify(payload),
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      created_at: queuedAt,
    })
    const placeholder = buildPlaceholder(queuedId, queuedAt, payload)
    updatePagedCache(queryKey, placeholder)
    return placeholder
  }
}

ensureOutboxProcessor()

export const api = {
  login: (username: string, password: string) => request<AuthResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  }),
  setupPassword: (token: string, newPassword: string) => request<AuthResponse>('/auth/password/setup', {
    method: 'POST',
    body: JSON.stringify({ token, new_password: newPassword }),
  }),
  changePassword: (currentPassword: string, newPassword: string) => request<{ status: string }>('/auth/password/change', {
    method: 'POST',
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  }),
  logout: () => request<{ status: string }>('/auth/logout', { method: 'POST' }),
  getSession: () => request<SessionInfo>('/auth/session'),
  getUserPreferences: () => request<UserPreferences>('/preferences'),
  updateUserPreferences: (payload: { weight_unit: WeightUnit }) => request<UserPreferences>('/preferences', { method: 'PUT', body: JSON.stringify(payload) }),
  getDashboard: () => request<{ cards: DashboardCard[]; available_modules: string[] }>('/dashboard'),
  getRuntime: () => request<RuntimeInfo>('/runtime'),
  listJobs: (params: { status?: string; limit?: number; cursor?: string | null } = {}) => request<PagedListResponse<JobRecord>>(`/jobs${buildQueryString(params)}`),
  listAiProfiles: () => request<{ items: AiProfile[]; features: string[] }>('/ai/profiles'),
  createAiProfile: (payload: Record<string, unknown>) => request<AiProfile>('/ai/profiles', { method: 'POST', body: JSON.stringify(payload) }),
  getAiProfile: (profileId: string) => request<{ profile: AiProfile }>(`/ai/profiles/${profileId}`),
  updateAiProfile: (profileId: string, payload: Record<string, unknown>) => request<AiProfile>(`/ai/profiles/${profileId}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteAiProfile: (profileId: string) => request<{ status: string; id: string }>(`/ai/profiles/${profileId}`, { method: 'DELETE' }),
  testAiProfile: (profileId: string) => request<{ profile_id: string; reachable: boolean; available_models: string[]; selected_model_available: boolean; error?: string | null }>(`/ai/profiles/${profileId}/test`, { method: 'POST' }),
  refreshAiProfileModels: (profileId: string) => request<AiProfile>(`/ai/profiles/${profileId}/models/refresh`, { method: 'POST' }),
  listAiFeatures: () => request<{ items: AiFeatureBinding[]; features: string[] }>('/ai/features'),
  updateAiFeatures: (items: Record<string, unknown>[]) => request<{ items: AiFeatureBinding[] }>('/ai/features', { method: 'PUT', body: JSON.stringify({ items }) }),
  getAiPersona: () => request<{ persona: AiPersonaConfig }>('/ai/persona'),
  updateAiPersona: (payload: Record<string, unknown>) => request<{ persona: AiPersonaConfig }>('/ai/persona', { method: 'PUT', body: JSON.stringify(payload) }),
  listFoods: (params?: string | ({ search?: string } & CursorListParams)) => {
    const normalized = typeof params === 'string' ? { search: params } : (params ?? {})
    return request<PagedListResponse<FoodItem>>(`/foods${buildQueryString(normalized)}`)
  },
  createFood: (payload: Partial<FoodItem> & { name: string }) => request<FoodItem>('/foods', { method: 'POST', body: JSON.stringify(payload) }),
  lookupBarcode: (barcode: string) => request<FoodImportDraft>(`/foods/barcode-lookup/${encodeURIComponent(barcode)}`),
  scanFoodLabel: async (file: File) => {
    const formData = new FormData()
    formData.append('file', await prepareImageUpload(file))
    return upload<FoodImportDraft>('/foods/label-photo', formData)
  },
  listRecipes: () => request<{ items: Recipe[]; total: number }>('/recipes'),
  createRecipe: (payload: Record<string, unknown>) => request<Recipe>('/recipes', { method: 'POST', body: JSON.stringify(payload) }),
  listMeals: (params: DateRangeListParams & { meal_type?: string; template_id?: string } = {}) => request<PagedListResponse<MealEntry>>(`/meals${buildQueryString(params)}`),
  createMeal: (payload: Record<string, unknown>) => queueableCreate<MealEntry & SyncMeta>('/meals', payload, buildQueuedMealEntry, ['meals']),
  updateMeal: (mealId: string, payload: Record<string, unknown>) => request<MealEntry>(`/meals/${mealId}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteMeal: (mealId: string) => request<{ status: string; id: string }>(`/meals/${mealId}`, { method: 'DELETE' }),
  listMealTemplates: () => request<{ items: MealTemplate[]; total: number }>('/meal-templates'),
  createMealTemplate: (payload: Record<string, unknown>) => request<MealTemplate>('/meal-templates', { method: 'POST', body: JSON.stringify(payload) }),
  updateMealTemplate: (templateId: string, payload: Record<string, unknown>) => request<MealTemplate>(`/meal-templates/${templateId}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteMealTemplate: (templateId: string) => request<{ status: string; id: string }>(`/meal-templates/${templateId}`, { method: 'DELETE' }),
  listMealPhotos: () => request<{ items: MealPhotoDraft[]; total: number }>('/meal-photos'),
  uploadMealPhoto: async (file: File) => {
    const formData = new FormData()
    formData.append('file', await prepareImageUpload(file))
    return upload<MealPhotoDraft>('/meal-photos', formData)
  },
  rerunMealPhotoAnalysis: (draftId: string) => request<MealPhotoDraft>(`/meal-photos/${draftId}/analyze`, { method: 'POST' }),
  confirmMealPhoto: (draftId: string, payload: Record<string, unknown>) => request<MealEntry>(`/meal-photos/${draftId}/confirm`, { method: 'POST', body: JSON.stringify(payload) }),
  listExercises: () => request<{ items: Exercise[]; total: number }>('/exercises'),
  createExercise: (payload: Record<string, unknown>) => request<Exercise>('/exercises', { method: 'POST', body: JSON.stringify(payload) }),
  getExerciseProgression: (exerciseId: string) => request<{ recommendation: { recommendation: string; next_load_kg: number; reason: string } }>(`/exercises/${exerciseId}/progression`),
  listRoutines: () => request<{ items: Routine[]; total: number }>('/routines'),
  createRoutine: (payload: Record<string, unknown>) => request<Routine>('/routines', { method: 'POST', body: JSON.stringify(payload) }),
  updateRoutine: (routineId: string, payload: Record<string, unknown>) => request<Routine>(`/routines/${routineId}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteRoutine: (routineId: string) => request<{ status: string; id: string }>(`/routines/${routineId}`, { method: 'DELETE' }),
  listWorkoutTemplates: () => request<{ items: WorkoutTemplate[]; total: number }>('/workout-templates'),
  createWorkoutTemplate: (payload: Record<string, unknown>) => request<WorkoutTemplate>('/workout-templates', { method: 'POST', body: JSON.stringify(payload) }),
  updateWorkoutTemplate: (templateId: string, payload: Record<string, unknown>) => request<WorkoutTemplate>(`/workout-templates/${templateId}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteWorkoutTemplate: (templateId: string) => request<{ status: string; id: string }>(`/workout-templates/${templateId}`, { method: 'DELETE' }),
  listWorkoutSessions: (params: DateRangeListParams & { template_id?: string } = {}) => request<PagedListResponse<WorkoutSession>>(`/workout-sessions${buildQueryString(params)}`),
  createWorkoutSession: (payload: Record<string, unknown>) => queueableCreate<WorkoutSession & SyncMeta>('/workout-sessions', payload, buildQueuedWorkoutSession, ['workout-sessions']),
  updateWorkoutSession: (sessionId: string, payload: Record<string, unknown>) => request<WorkoutSession>(`/workout-sessions/${sessionId}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteWorkoutSession: (sessionId: string) => request<{ status: string; id: string }>(`/workout-sessions/${sessionId}`, { method: 'DELETE' }),
  listWeightEntries: (params: DateRangeListParams = {}) => request<PagedListResponse<WeightEntry>>(`/weight-entries${buildQueryString(params)}`),
  getWeightTrends: (days = 180) => request<{ points: WeightTrendPoint[]; weight_trend_kg_per_week: number }>(`/weight-entries/trends${buildQueryString({ days })}`),
  createWeightEntry: (payload: Record<string, unknown>) => queueableCreate<WeightEntry & SyncMeta>('/weight-entries', payload, buildQueuedWeightEntry, ['weight-entries']),
  updateWeightEntry: (entryId: string, payload: Record<string, unknown>) => request<WeightEntry>(`/weight-entries/${entryId}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteWeightEntry: (entryId: string) => request<{ status: string; id: string }>(`/weight-entries/${entryId}`, { method: 'DELETE' }),
  getInsights: () => request<{ snapshot: InsightSnapshot }>('/insights'),
  getInsightSummary: (days = 90) => request<{ summary: InsightSummary }>('/insights/summary' + buildQueryString({ days })),
  recomputeInsights: () => request<{ snapshot: InsightSnapshot }>('/insights/recompute', { method: 'POST' }),
  listGoals: () => request<{ items: Goal[]; total: number }>('/goals'),
  createGoal: (payload: Record<string, unknown>) => request<Goal>('/goals', { method: 'POST', body: JSON.stringify(payload) }),
  deleteGoal: (goalId: string) => request<{ status: string; id: string }>(`/goals/${goalId}`, { method: 'DELETE' }),
  listApiKeys: () => request<{ items: ApiKeyRecord[]; total: number }>('/api-keys'),
  createApiKey: (payload: Record<string, unknown>) => request<ApiKeyRecord>('/api-keys', { method: 'POST', body: JSON.stringify(payload) }),
  revokeApiKey: (keyId: string) => request<{ status: string; id: string }>(`/api-keys/${keyId}`, { method: 'DELETE' }),
  listUsers: () => request<{ items: ManagedUser[]; total: number }>('/users'),
  createUser: (payload: { username: string; is_admin?: boolean }) => request<UserSetupResponse>('/users', { method: 'POST', body: JSON.stringify(payload) }),
  issuePasswordSetup: (userId: string) => request<UserSetupResponse>(`/users/${userId}/password-setup`, { method: 'POST' }),
  listExports: (params: CursorListParams = {}) => request<PagedListResponse<ExportRecord>>(`/exports${buildQueryString(params)}`),
  createExport: () => request<ExportRecord>('/exports', { method: 'POST' }),
  restoreExport: (payload: Record<string, unknown>) => request<{ status: string; counts: Record<string, number> }>('/exports/restore', {
    method: 'POST',
    body: JSON.stringify({ payload }),
  }),
  parseAssistantNote: (note: string) => request<AssistantDraftResponse>('/assistant/parse', { method: 'POST', body: JSON.stringify({ note }) }),
  getAssistantBrief: () => request<{ brief: AssistantBrief }>('/assistant/brief'),
  refreshAssistantBrief: () => request<{ brief: AssistantBrief }>('/assistant/brief/refresh', { method: 'POST' }),
  askCoachAdvice: (prompt: string) => request<{ advice: AssistantCoachAdvice }>('/assistant/advice', { method: 'POST', body: JSON.stringify({ prompt }) }),
}
