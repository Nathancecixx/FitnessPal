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
  source_path: string
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
  session_token?: string
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
  payload: Record<string, unknown>
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
    persona: AiPersonaConfig
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

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api/v1'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers ?? {})
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...init,
    headers,
  })

  if (!response.ok) {
    const errorBody = await response.text()
    try {
      const parsed = JSON.parse(errorBody) as { detail?: string }
      throw new Error(parsed.detail || `Request failed with ${response.status}`)
    } catch {
      throw new Error(errorBody || `Request failed with ${response.status}`)
    }
  }

  return response.json() as Promise<T>
}

async function upload<T>(path: string, formData: FormData): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  })

  if (!response.ok) {
    throw new Error(await response.text())
  }

  return response.json() as Promise<T>
}

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
  getDashboard: () => request<{ cards: DashboardCard[]; available_modules: string[] }>('/dashboard'),
  getRuntime: () => request<RuntimeInfo>('/runtime'),
  listJobs: (status?: string) => request<{ items: JobRecord[]; total: number }>(`/jobs${status ? `?status=${encodeURIComponent(status)}` : ''}`),
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
  listFoods: (search?: string) => request<{ items: FoodItem[]; total: number }>(`/foods${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  createFood: (payload: Partial<FoodItem> & { name: string }) => request<FoodItem>('/foods', { method: 'POST', body: JSON.stringify(payload) }),
  lookupBarcode: (barcode: string) => request<FoodImportDraft>(`/foods/barcode-lookup/${encodeURIComponent(barcode)}`),
  scanFoodLabel: (file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    return upload<FoodImportDraft>('/foods/label-photo', formData)
  },
  listRecipes: () => request<{ items: Recipe[]; total: number }>('/recipes'),
  createRecipe: (payload: Record<string, unknown>) => request<Recipe>('/recipes', { method: 'POST', body: JSON.stringify(payload) }),
  listMeals: () => request<{ items: MealEntry[]; total: number }>('/meals'),
  createMeal: (payload: Record<string, unknown>) => request<MealEntry>('/meals', { method: 'POST', body: JSON.stringify(payload) }),
  updateMeal: (mealId: string, payload: Record<string, unknown>) => request<MealEntry>(`/meals/${mealId}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteMeal: (mealId: string) => request<{ status: string; id: string }>(`/meals/${mealId}`, { method: 'DELETE' }),
  listMealTemplates: () => request<{ items: MealTemplate[]; total: number }>('/meal-templates'),
  createMealTemplate: (payload: Record<string, unknown>) => request<MealTemplate>('/meal-templates', { method: 'POST', body: JSON.stringify(payload) }),
  listMealPhotos: () => request<{ items: MealPhotoDraft[]; total: number }>('/meal-photos'),
  uploadMealPhoto: (file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    return upload<MealPhotoDraft>('/meal-photos', formData)
  },
  rerunMealPhotoAnalysis: (draftId: string) => request<MealPhotoDraft>(`/meal-photos/${draftId}/analyze`, { method: 'POST' }),
  confirmMealPhoto: (draftId: string, payload: Record<string, unknown>) => request<MealEntry>(`/meal-photos/${draftId}/confirm`, { method: 'POST', body: JSON.stringify(payload) }),
  listExercises: () => request<{ items: Exercise[]; total: number }>('/exercises'),
  createExercise: (payload: Record<string, unknown>) => request<Exercise>('/exercises', { method: 'POST', body: JSON.stringify(payload) }),
  getExerciseProgression: (exerciseId: string) => request<{ recommendation: { recommendation: string; next_load_kg: number; reason: string } }>(`/exercises/${exerciseId}/progression`),
  listWorkoutTemplates: () => request<{ items: WorkoutTemplate[]; total: number }>('/workout-templates'),
  createWorkoutTemplate: (payload: Record<string, unknown>) => request<WorkoutTemplate>('/workout-templates', { method: 'POST', body: JSON.stringify(payload) }),
  listWorkoutSessions: () => request<{ items: WorkoutSession[]; total: number }>('/workout-sessions'),
  createWorkoutSession: (payload: Record<string, unknown>) => request<WorkoutSession>('/workout-sessions', { method: 'POST', body: JSON.stringify(payload) }),
  updateWorkoutSession: (sessionId: string, payload: Record<string, unknown>) => request<WorkoutSession>(`/workout-sessions/${sessionId}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteWorkoutSession: (sessionId: string) => request<{ status: string; id: string }>(`/workout-sessions/${sessionId}`, { method: 'DELETE' }),
  listWeightEntries: () => request<{ items: WeightEntry[]; total: number }>('/weight-entries'),
  getWeightTrends: () => request<{ points: WeightTrendPoint[]; weight_trend_kg_per_week: number }>('/weight-entries/trends'),
  createWeightEntry: (payload: Record<string, unknown>) => request<WeightEntry>('/weight-entries', { method: 'POST', body: JSON.stringify(payload) }),
  updateWeightEntry: (entryId: string, payload: Record<string, unknown>) => request<WeightEntry>(`/weight-entries/${entryId}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteWeightEntry: (entryId: string) => request<{ status: string; id: string }>(`/weight-entries/${entryId}`, { method: 'DELETE' }),
  getInsights: () => request<{ snapshot: InsightSnapshot }>('/insights'),
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
  listExports: () => request<{ items: ExportRecord[]; total: number }>('/exports'),
  createExport: () => request<ExportRecord>('/exports', { method: 'POST' }),
  restoreExport: (payload: Record<string, unknown>) => request<{ status: string; counts: Record<string, number> }>('/exports/restore', {
    method: 'POST',
    body: JSON.stringify({ payload }),
  }),
  parseAssistantNote: (note: string) => request<AssistantDraftResponse>('/assistant/parse', { method: 'POST', body: JSON.stringify({ note }) }),
  getAssistantBrief: () => request<{ brief: AssistantBrief }>('/assistant/brief'),
  refreshAssistantBrief: () => request<{ brief: AssistantBrief }>('/assistant/brief/refresh', { method: 'POST' }),
}
