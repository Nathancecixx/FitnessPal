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
  calories: number
  protein_g: number
  carbs_g: number
  fat_g: number
  fiber_g: number
  sodium_mg: number
  tags_json: string[]
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

export type ExportRecord = {
  id: string
  format: string
  status: string
  path: string
  summary: Record<string, number>
  created_at: string
  finished_at?: string | null
}

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api/v1'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  })

  if (!response.ok) {
    const errorBody = await response.text()
    throw new Error(errorBody || `Request failed with ${response.status}`)
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
  login: (username: string, password: string) => request<{ user: { id: string; username: string } }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  }),
  getSession: () => request<{ actor: { id: string; type: string; display_name: string; scopes: string[] } }>('/auth/session'),
  getDashboard: () => request<{ cards: DashboardCard[]; available_modules: string[] }>('/dashboard'),
  listFoods: (search?: string) => request<{ items: FoodItem[]; total: number }>(`/foods${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  createFood: (payload: Partial<FoodItem> & { name: string }) => request<FoodItem>('/foods', { method: 'POST', body: JSON.stringify(payload) }),
  listMeals: () => request<{ items: MealEntry[]; total: number }>('/meals'),
  createMeal: (payload: Record<string, unknown>) => request<MealEntry>('/meals', { method: 'POST', body: JSON.stringify(payload) }),
  listMealTemplates: () => request<{ items: MealTemplate[]; total: number }>('/meal-templates'),
  listMealPhotos: () => request<{ items: MealPhotoDraft[]; total: number }>('/meal-photos'),
  uploadMealPhoto: (file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    return upload<MealPhotoDraft>('/meal-photos', formData)
  },
  confirmMealPhoto: (draftId: string, payload: Record<string, unknown>) => request<MealEntry>(`/meal-photos/${draftId}/confirm`, { method: 'POST', body: JSON.stringify(payload) }),
  listExercises: () => request<{ items: Exercise[]; total: number }>('/exercises'),
  createExercise: (payload: Record<string, unknown>) => request<Exercise>('/exercises', { method: 'POST', body: JSON.stringify(payload) }),
  getExerciseProgression: (exerciseId: string) => request<{ recommendation: { recommendation: string; next_load_kg: number; reason: string } }>(`/exercises/${exerciseId}/progression`),
  listWorkoutTemplates: () => request<{ items: WorkoutTemplate[]; total: number }>('/workout-templates'),
  listWorkoutSessions: () => request<{ items: WorkoutSession[]; total: number }>('/workout-sessions'),
  createWorkoutSession: (payload: Record<string, unknown>) => request<WorkoutSession>('/workout-sessions', { method: 'POST', body: JSON.stringify(payload) }),
  listWeightEntries: () => request<{ items: WeightEntry[]; total: number }>('/weight-entries'),
  getWeightTrends: () => request<{ points: WeightTrendPoint[]; weight_trend_kg_per_week: number }>('/weight-entries/trends'),
  createWeightEntry: (payload: Record<string, unknown>) => request<WeightEntry>('/weight-entries', { method: 'POST', body: JSON.stringify(payload) }),
  getInsights: () => request<{ snapshot: InsightSnapshot }>('/insights'),
  recomputeInsights: () => request<{ snapshot: InsightSnapshot }>('/insights/recompute', { method: 'POST' }),
  listGoals: () => request<{ items: Goal[]; total: number }>('/goals'),
  createGoal: (payload: Record<string, unknown>) => request<Goal>('/goals', { method: 'POST', body: JSON.stringify(payload) }),
  listApiKeys: () => request<{ items: ApiKeyRecord[]; total: number }>('/api-keys'),
  createApiKey: (payload: Record<string, unknown>) => request<ApiKeyRecord>('/api-keys', { method: 'POST', body: JSON.stringify(payload) }),
  listExports: () => request<{ items: ExportRecord[]; total: number }>('/exports'),
  createExport: () => request<ExportRecord>('/exports', { method: 'POST' }),
  getAgentManifestUrl: () => (import.meta.env.VITE_AGENT_MANIFEST_URL ?? 'http://localhost:8000/.well-known/fitnesspal-agent.json'),
}
