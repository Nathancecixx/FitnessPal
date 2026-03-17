import { useMutation, useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { CoachNudgePanel, filterCoachNudges } from '../../components/coach-panels'
import { ActionButton, ConfirmSheet, type ConfirmSheetRequest, DraftStatusBanner, EmptyState, ErrorState, LabelledInput, LabelledSelect, LoadingState, PageIntro, Panel } from '../../components/ui'
import { api, type FoodImportDraft, type FoodItem, type MealEntry, type MealEntryItem, type MealPhotoDraft } from '../../lib/api'
import { useDraftState } from '../../lib/draft-store'
import { queryClient } from '../../lib/query-client'

type DraftEditorItem = {
  label: string
  grams: string
  calories: string
  protein_g: string
  carbs_g: string
  fat_g: string
  fiber_g: string
  sodium_mg: string
  source_type: string
}

type EditableMealDraft = {
  meal_type: string
  logged_at: string
  notes: string
  items: DraftEditorItem[]
}

function toDraftEditorItem(item: MealEntryItem): DraftEditorItem {
  return {
    label: item.label,
    grams: String(item.grams ?? ''),
    calories: String(item.calories ?? 0),
    protein_g: String(item.protein_g ?? 0),
    carbs_g: String(item.carbs_g ?? 0),
    fat_g: String(item.fat_g ?? 0),
    fiber_g: String(item.fiber_g ?? 0),
    sodium_mg: String(item.sodium_mg ?? 0),
    source_type: item.source_type,
  }
}

function toEditableMealDraft(meal: MealEntry): EditableMealDraft {
  return {
    meal_type: meal.meal_type,
    logged_at: meal.logged_at.slice(0, 16),
    notes: meal.notes ?? '',
    items: meal.items.map((item) => toDraftEditorItem(item)),
  }
}

function toStartOfDayIso(value: string) {
  return value ? `${value}T00:00:00` : undefined
}

function toEndOfDayIso(value: string) {
  return value ? `${value}T23:59:59` : undefined
}

export function NutritionPage() {
  const [mealLimit, setMealLimit] = useState(10)
  const [mealFilters, setMealFilters] = useState({ meal_type: '', date_from: '', date_to: '' })
  const [foodSearch, setFoodSearch] = useState('')
  const feedQuery = useQuery({ queryKey: ['assistant-feed'], queryFn: api.getAssistantFeed, retry: false })
  const foodsQuery = useQuery({ queryKey: ['foods', foodSearch], queryFn: () => api.listFoods({ search: foodSearch || undefined, limit: 100 }) })
  const favoriteFoodsQuery = useQuery({ queryKey: ['foods', 'favorites'], queryFn: () => api.listFoods({ favorites_only: true, limit: 8 }) })
  const recipesQuery = useQuery({ queryKey: ['recipes'], queryFn: api.listRecipes })
  const mealsQuery = useQuery({
    queryKey: ['meals', mealLimit, mealFilters.meal_type, mealFilters.date_from, mealFilters.date_to],
    queryFn: () => api.listMeals({
      limit: mealLimit,
      meal_type: mealFilters.meal_type || undefined,
      date_from: toStartOfDayIso(mealFilters.date_from),
      date_to: toEndOfDayIso(mealFilters.date_to),
    }),
  })
  const templatesQuery = useQuery({ queryKey: ['meal-templates'], queryFn: api.listMealTemplates })
  const photosQuery = useQuery({
    queryKey: ['meal-photos'],
    queryFn: api.listMealPhotos,
    refetchInterval: (query) => {
      const drafts = query.state.data?.items ?? []
      return drafts.some((draft) => draft.status === 'queued' || draft.status === 'processing') ? 3000 : false
    },
  })
  const foodDraftState = useDraftState({
    formId: 'nutrition-food-draft',
    initialValue: {
      name: '',
      brand: '',
      serving_name: '100 g',
      calories: '165',
      protein_g: '31',
      carbs_g: '0',
      fat_g: '3.6',
      fiber_g: '0',
      sugar_g: '0',
      sodium_mg: '0',
      notes: '',
    },
    route: '/nutrition',
  })
  const foodDraft = foodDraftState.value
  const setFoodDraft = foodDraftState.setValue
  const [barcodeDraft, setBarcodeDraft] = useState('')
  const [importStatus, setImportStatus] = useState('')
  const quickMealState = useDraftState({
    formId: 'nutrition-quick-meal',
    initialValue: { label: 'Quick meal', calories: '650', protein_g: '45', carbs_g: '60', fat_g: '20', meal_type: 'lunch', notes: '' },
    route: '/nutrition',
  })
  const quickMeal = quickMealState.value
  const setQuickMeal = quickMealState.setValue
  const recipeDraftState = useDraftState({
    formId: 'nutrition-recipe-draft',
    initialValue: {
      name: 'Chicken rice bowl',
      servings: '1',
      items: [{ food_id: '', grams: '180' }],
    },
    route: '/nutrition',
  })
  const recipeDraft = recipeDraftState.value
  const setRecipeDraft = recipeDraftState.setValue
  const [photoStatus, setPhotoStatus] = useState<string>('')
  const photoEditorsState = useDraftState<Record<string, DraftEditorItem[]>>({ formId: 'nutrition-photo-editors', initialValue: {}, route: '/nutrition' })
  const photoEditors = photoEditorsState.value
  const setPhotoEditors = photoEditorsState.setValue
  const mealEditorsState = useDraftState<Record<string, EditableMealDraft>>({ formId: 'nutrition-meal-editors', initialValue: {}, route: '/nutrition' })
  const mealEditors = mealEditorsState.value
  const setMealEditors = mealEditorsState.setValue
  const [editingMealId, setEditingMealId] = useState<string | null>(null)
  const [editingFoodId, setEditingFoodId] = useState<string | null>(null)
  const [confirmRequest, setConfirmRequest] = useState<ConfirmSheetRequest | null>(null)

  function applyImportedFood(result: FoodImportDraft) {
    setFoodDraft({
      name: result.food.name,
      brand: result.food.brand ?? '',
      serving_name: result.food.serving_name ?? '100 g',
      calories: String(result.food.calories ?? 0),
      protein_g: String(result.food.protein_g ?? 0),
      carbs_g: String(result.food.carbs_g ?? 0),
      fat_g: String(result.food.fat_g ?? 0),
      fiber_g: String(result.food.fiber_g ?? 0),
      sugar_g: String(result.food.sugar_g ?? 0),
      sodium_mg: String(result.food.sodium_mg ?? 0),
      notes: result.food.notes ?? '',
    })
  }

  const saveFood = useMutation({
    mutationFn: () => (editingFoodId ? api.updateFood(editingFoodId, {
      name: foodDraft.name,
      brand: foodDraft.brand || null,
      serving_name: foodDraft.serving_name || null,
      calories: Number(foodDraft.calories || 0),
      protein_g: Number(foodDraft.protein_g || 0),
      carbs_g: Number(foodDraft.carbs_g || 0),
      fat_g: Number(foodDraft.fat_g || 0),
      fiber_g: Number(foodDraft.fiber_g || 0),
      sugar_g: Number(foodDraft.sugar_g || 0),
      sodium_mg: Number(foodDraft.sodium_mg || 0),
      notes: foodDraft.notes || null,
    }) : api.createFood({
      name: foodDraft.name,
      brand: foodDraft.brand || undefined,
      serving_name: foodDraft.serving_name || undefined,
      calories: Number(foodDraft.calories),
      protein_g: Number(foodDraft.protein_g),
      carbs_g: Number(foodDraft.carbs_g),
      fat_g: Number(foodDraft.fat_g),
      fiber_g: Number(foodDraft.fiber_g),
      sugar_g: Number(foodDraft.sugar_g),
      sodium_mg: Number(foodDraft.sodium_mg),
      notes: foodDraft.notes || undefined,
    })),
    onSuccess: async () => {
      setEditingFoodId(null)
      foodDraftState.meta.clearDraft()
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['foods'] }),
        queryClient.invalidateQueries({ queryKey: ['foods', 'favorites'] }),
      ])
    },
  })

  const createQuickMeal = useMutation({
    mutationFn: () => api.createMeal({
      meal_type: quickMeal.meal_type,
      source: 'manual',
      items: [
        {
          label: quickMeal.label,
          calories: Number(quickMeal.calories),
          protein_g: Number(quickMeal.protein_g),
          carbs_g: Number(quickMeal.carbs_g),
          fat_g: Number(quickMeal.fat_g),
          source_type: 'manual',
        },
      ],
      notes: quickMeal.notes || undefined,
    }),
    onSuccess: async () => {
      quickMealState.meta.clearDraft()
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['meals'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['insights'] }),
        queryClient.invalidateQueries({ queryKey: ['insights-summary'] }),
      ])
    },
  })

  const createRecipe = useMutation({
    mutationFn: () => api.createRecipe({
      name: recipeDraft.name,
      servings: Number(recipeDraft.servings),
      items: recipeDraft.items
        .filter((item) => item.food_id)
        .map((item) => ({ food_id: item.food_id, grams: Number(item.grams) })),
    }),
    onSuccess: async () => {
      recipeDraftState.meta.clearDraft()
      await queryClient.invalidateQueries({ queryKey: ['recipes'] })
    },
  })

  const logRecipeMeal = useMutation({
    mutationFn: (recipeId: string) => api.createMeal({
      meal_type: 'meal',
      recipe_id: recipeId,
      source: 'recipe',
    }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['meals'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['insights'] }),
        queryClient.invalidateQueries({ queryKey: ['insights-summary'] }),
      ])
    },
  })

  const logTemplateMeal = useMutation({
    mutationFn: (templateId: string) => api.createMeal({
      meal_type: 'meal',
      template_id: templateId,
      source: 'template',
    }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['meals'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['insights'] }),
        queryClient.invalidateQueries({ queryKey: ['insights-summary'] }),
      ])
    },
  })

  const repeatRecentMeal = useMutation({
    mutationFn: (meal: MealEntry) => api.createMeal({
      meal_type: meal.meal_type,
      source: 'manual',
      notes: meal.notes || undefined,
      items: meal.items.map((item) => ({
        label: item.label,
        grams: item.grams ?? null,
        calories: item.calories,
        protein_g: item.protein_g,
        carbs_g: item.carbs_g,
        fat_g: item.fat_g,
        fiber_g: item.fiber_g ?? 0,
        sodium_mg: item.sodium_mg ?? 0,
        source_type: item.source_type,
      })),
    }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['meals'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['insights'] }),
        queryClient.invalidateQueries({ queryKey: ['insights-summary'] }),
      ])
    },
  })

  const toggleFavoriteFood = useMutation({
    mutationFn: ({ foodId, isFavorite }: { foodId: string; isFavorite: boolean }) => api.updateFood(foodId, { is_favorite: isFavorite }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['foods'] }),
        queryClient.invalidateQueries({ queryKey: ['foods', 'favorites'] }),
      ])
    },
  })

  const importBarcode = useMutation({
    mutationFn: () => api.lookupBarcode(barcodeDraft),
    onSuccess: (result) => {
      applyImportedFood(result)
      setImportStatus(`Loaded ${result.food.name} from ${result.source}. Review before saving.`)
    },
    onError: (error) => setImportStatus(error.message),
  })

  const scanLabel = useMutation({
    mutationFn: (file: File) => api.scanFoodLabel(file),
    onSuccess: (result) => {
      applyImportedFood(result)
      setImportStatus(`Scanned ${result.food.name}. Review the draft before saving.`)
    },
    onError: (error) => setImportStatus(error.message),
  })

  const uploadPhoto = useMutation({
    mutationFn: async (file: File) => api.uploadMealPhoto(file),
    onMutate: () => setPhotoStatus('Uploading and scheduling analysis...'),
    onSuccess: async () => {
      setPhotoStatus('Photo queued. Review the draft when the worker returns a guess.')
      await queryClient.invalidateQueries({ queryKey: ['meal-photos'] })
    },
    onError: (error) => setPhotoStatus(error.message),
  })

  const rerunPhoto = useMutation({
    mutationFn: (draftId: string) => api.rerunMealPhotoAnalysis(draftId),
    onSuccess: async () => {
      setPhotoStatus('Draft re-queued for analysis.')
      await queryClient.invalidateQueries({ queryKey: ['meal-photos'] })
    },
  })

  const confirmPhoto = useMutation({
    mutationFn: ({ draftId, items }: { draftId: string; items: DraftEditorItem[] }) => api.confirmMealPhoto(draftId, {
      meal_type: 'meal',
      items: items.map((item) => ({
        label: item.label,
        grams: item.grams ? Number(item.grams) : null,
        calories: Number(item.calories),
        protein_g: Number(item.protein_g),
        carbs_g: Number(item.carbs_g),
        fat_g: Number(item.fat_g),
        fiber_g: Number(item.fiber_g),
        sodium_mg: Number(item.sodium_mg),
        source_type: item.source_type,
      })),
    }),
    onSuccess: async (_, variables) => {
      setPhotoStatus('Draft confirmed and saved as a meal.')
      setPhotoEditors((state) => {
        const next = { ...state }
        delete next[variables.draftId]
        return next
      })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['meal-photos'] }),
        queryClient.invalidateQueries({ queryKey: ['meals'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['insights'] }),
        queryClient.invalidateQueries({ queryKey: ['insights-summary'] }),
      ])
    },
    onError: (error) => setPhotoStatus(error.message),
  })

  const updateMeal = useMutation({
    mutationFn: ({ mealId, payload }: { mealId: string; payload: Record<string, unknown> }) => api.updateMeal(mealId, payload),
    onSuccess: async (_, variables) => {
      setEditingMealId(null)
      setMealEditors((state) => {
        const next = { ...state }
        delete next[variables.mealId]
        return next
      })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['meals'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['insights'] }),
        queryClient.invalidateQueries({ queryKey: ['insights-summary'] }),
      ])
    },
    onError: (error) => setPhotoStatus(error.message),
  })

  const deleteMeal = useMutation({
    mutationFn: (mealId: string) => api.deleteMeal(mealId),
    onSuccess: async (_, mealId) => {
      if (editingMealId === mealId) {
        setEditingMealId(null)
      }
      setMealEditors((state) => {
        const next = { ...state }
        delete next[mealId]
        return next
      })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['meals'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['insights'] }),
        queryClient.invalidateQueries({ queryKey: ['insights-summary'] }),
      ])
    },
  })

  const quickMealErrors = {
    label: quickMeal.label.trim() ? '' : 'Add a meal label.',
    calories: Number(quickMeal.calories) > 0 ? '' : 'Calories must be greater than zero.',
    protein_g: Number(quickMeal.protein_g) >= 0 ? '' : 'Protein cannot be negative.',
    carbs_g: Number(quickMeal.carbs_g) >= 0 ? '' : 'Carbs cannot be negative.',
    fat_g: Number(quickMeal.fat_g) >= 0 ? '' : 'Fat cannot be negative.',
  }
  const foodErrors = {
    name: foodDraft.name.trim() ? '' : 'Food name is required.',
    calories: Number(foodDraft.calories) >= 0 ? '' : 'Calories cannot be negative.',
    protein_g: Number(foodDraft.protein_g) >= 0 ? '' : 'Protein cannot be negative.',
    carbs_g: Number(foodDraft.carbs_g) >= 0 ? '' : 'Carbs cannot be negative.',
    fat_g: Number(foodDraft.fat_g) >= 0 ? '' : 'Fat cannot be negative.',
  }
  const recipeError = recipeDraft.name.trim() && recipeDraft.items.some((item) => item.food_id && Number(item.grams) > 0)
    ? ''
    : 'Add a recipe name and at least one ingredient with grams.'
  const favoriteFoods = useMemo(() => favoriteFoodsQuery.data?.items ?? [], [favoriteFoodsQuery.data?.items])
  const searchFoods = useMemo(() => foodsQuery.data?.items ?? [], [foodsQuery.data?.items])
  const repeatRecipes = useMemo(() => (recipesQuery.data?.items ?? []).slice(0, 3), [recipesQuery.data?.items])
  const repeatTemplates = useMemo(() => (templatesQuery.data?.items ?? []).slice(0, 3), [templatesQuery.data?.items])
  const nutritionNudges = useMemo(() => filterCoachNudges(feedQuery.data?.feed.nudges, 'nutrition'), [feedQuery.data?.feed.nudges])

  function getPhotoEditorItems(draft: MealPhotoDraft): DraftEditorItem[] {
    return photoEditors[draft.id] ?? draft.candidates.map((item) => toDraftEditorItem(item))
  }

  function updatePhotoEditorItem(draft: MealPhotoDraft, index: number, key: keyof DraftEditorItem, value: string) {
    const current = getPhotoEditorItems(draft)
    const next = [...current]
    next[index] = { ...next[index], [key]: value }
    setPhotoEditors((state) => ({ ...state, [draft.id]: next }))
  }

  function getMealEditor(meal: MealEntry): EditableMealDraft {
    return mealEditors[meal.id] ?? toEditableMealDraft(meal)
  }

  function updateMealEditor(mealId: string, key: keyof Omit<EditableMealDraft, 'items'>, value: string) {
    setMealEditors((state) => {
      const current = state[mealId]
      if (!current) {
        return state
      }
      return { ...state, [mealId]: { ...current, [key]: value } }
    })
  }

  function updateMealEditorItem(mealId: string, index: number, key: keyof DraftEditorItem, value: string) {
    setMealEditors((state) => {
      const current = state[mealId]
      if (!current) {
        return state
      }
      const nextItems = [...current.items]
      nextItems[index] = { ...nextItems[index], [key]: value }
      return { ...state, [mealId]: { ...current, items: nextItems } }
    })
  }

  function startEditingMeal(meal: MealEntry) {
    setMealEditors((state) => ({ ...state, [meal.id]: toEditableMealDraft(meal) }))
    setEditingMealId(meal.id)
  }

  function startEditingFood(food: FoodItem) {
    setEditingFoodId(food.id)
    setFoodDraft({
      name: food.name,
      brand: food.brand ?? '',
      serving_name: food.serving_name ?? '100 g',
      calories: String(food.calories ?? 0),
      protein_g: String(food.protein_g ?? 0),
      carbs_g: String(food.carbs_g ?? 0),
      fat_g: String(food.fat_g ?? 0),
      fiber_g: String(food.fiber_g ?? 0),
      sugar_g: String(food.sugar_g ?? 0),
      sodium_mg: String(food.sodium_mg ?? 0),
      notes: food.notes ?? '',
    })
  }

  return (
    <div className="space-y-4">
      <PageIntro
        eyebrow="Nutrition"
        title="Quick food logging first"
        description="Log meals fast. Open the deeper tools only when you need them."
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <div className="space-y-4">
          <CoachNudgePanel
            title="Coach cues"
            subtitle="Quick nutrition notes."
            nudges={nutritionNudges}
            emptyTitle="No nutrition cues right now"
            emptyBody="Coach notes will show up here when needed."
          />

          <Panel title="One-tap repeats" subtitle="Your fastest options first.">
            {mealsQuery.isLoading || recipesQuery.isLoading || templatesQuery.isLoading ? (
              <LoadingState title="Loading quick repeats" body="Loading saved meals and templates." />
            ) : (
              <div className="space-y-3">
                {(mealsQuery.data?.items ?? []).slice(0, 2).map((meal) => (
                  <div key={`repeat-${meal.id}`} className="rounded-[22px] border border-slate-200 bg-white p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-slate-950">{meal.meal_type}</div>
                        <div className="mt-1 text-sm text-slate-500">{meal.items.map((item) => item.label).join(', ')}</div>
                      </div>
                      <ActionButton tone="secondary" onClick={() => repeatRecentMeal.mutate(meal)} className="w-auto">Repeat</ActionButton>
                    </div>
                  </div>
                ))}
                {repeatTemplates.map((template) => (
                  <div key={template.id} className="rounded-[22px] border border-slate-200 bg-white p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-slate-950">{template.name}</div>
                        <div className="mt-1 text-sm text-slate-500">{Math.round(template.totals.calories)} kcal template</div>
                      </div>
                      <ActionButton tone="secondary" onClick={() => logTemplateMeal.mutate(template.id)} className="w-auto">Log</ActionButton>
                    </div>
                  </div>
                ))}
                {repeatRecipes.map((recipe) => (
                  <div key={recipe.id} className="rounded-[22px] border border-slate-200 bg-white p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-slate-950">{recipe.name}</div>
                        <div className="mt-1 text-sm text-slate-500">{Math.round(recipe.per_serving.calories)} kcal per serving</div>
                      </div>
                      <ActionButton tone="secondary" onClick={() => logRecipeMeal.mutate(recipe.id)} className="w-auto">Log</ActionButton>
                    </div>
                  </div>
                ))}
                {!mealsQuery.data?.items?.length && !repeatRecipes.length && !repeatTemplates.length ? (
                  <EmptyState title="No quick repeats yet" body="Recent meals and saved items will show up here." />
                ) : null}
              </div>
            )}
          </Panel>

          <Panel title="Fast meal log" subtitle="Manual entry, kept simple.">
            <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); if (!Object.values(quickMealErrors).some(Boolean)) { createQuickMeal.mutate() } }}>
              <div className="sm:col-span-2">
                <DraftStatusBanner restored={quickMealState.meta.restored} savedAt={quickMealState.meta.savedAt} onDiscard={quickMealState.meta.clearDraft} />
              </div>
              <div className="sm:col-span-2"><LabelledInput label="Meal label" value={quickMeal.label} onChange={(value) => setQuickMeal((current) => ({ ...current, label: value }))} error={quickMealErrors.label || undefined} /></div>
              <LabelledSelect
                label="Meal type"
                value={quickMeal.meal_type}
                onChange={(value) => setQuickMeal((current) => ({ ...current, meal_type: value }))}
                options={[
                  { label: 'Breakfast', value: 'breakfast' },
                  { label: 'Lunch', value: 'lunch' },
                  { label: 'Dinner', value: 'dinner' },
                  { label: 'Snack', value: 'snack' },
                  { label: 'Meal', value: 'meal' },
                ]}
              />
              <LabelledInput label="Calories" type="number" value={quickMeal.calories} onChange={(value) => setQuickMeal((current) => ({ ...current, calories: value }))} error={quickMealErrors.calories || undefined} />
              <LabelledInput label="Protein" type="number" value={quickMeal.protein_g} onChange={(value) => setQuickMeal((current) => ({ ...current, protein_g: value }))} error={quickMealErrors.protein_g || undefined} />
              <LabelledInput label="Carbs" type="number" value={quickMeal.carbs_g} onChange={(value) => setQuickMeal((current) => ({ ...current, carbs_g: value }))} error={quickMealErrors.carbs_g || undefined} />
              <LabelledInput label="Fat" type="number" value={quickMeal.fat_g} onChange={(value) => setQuickMeal((current) => ({ ...current, fat_g: value }))} error={quickMealErrors.fat_g || undefined} />
              <div className="sm:col-span-2"><LabelledInput label="Notes" value={quickMeal.notes} onChange={(value) => setQuickMeal((current) => ({ ...current, notes: value }))} /></div>
              <ActionButton type="submit" className="sm:col-span-2 sm:w-auto" disabled={createQuickMeal.isPending || Object.values(quickMealErrors).some(Boolean)}>{createQuickMeal.isPending ? 'Saving...' : 'Save meal'}</ActionButton>
            </form>
          </Panel>

          <Panel title="Photo log" subtitle="Upload, review, save.">
            <label className="flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-[24px] border border-dashed border-slate-300 bg-slate-50 px-4 text-center text-sm text-slate-500">
              <span className="font-display text-2xl text-slate-800">Take or choose a food photo</span>
              <span className="mt-2 max-w-xs leading-6">Review the draft before saving.</span>
              <input type="file" accept="image/*" className="hidden" onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) uploadPhoto.mutate(file)
              }} />
            </label>
            {photoStatus ? <div className="app-status app-status-warning mt-3 rounded-2xl px-4 py-3 text-sm">{photoStatus}</div> : null}

            <div className="mt-4 space-y-3">
              {(photosQuery.data?.items ?? []).slice(0, 3).map((draft) => {
                const editorItems = getPhotoEditorItems(draft)
                const canConfirm = editorItems.length > 0 && (draft.status === 'ready' || draft.status === 'needs_review')
                return (
                  <details key={draft.id} className="rounded-[22px] border border-slate-200 bg-white p-4">
                    <summary className="cursor-pointer list-none">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-semibold text-slate-950">{draft.status}</div>
                          <div className="mt-1 text-sm text-slate-500">
                            {draft.provider ?? 'Waiting for worker'}{draft.model_name ? ` - ${draft.model_name}` : ''}
                          </div>
                        </div>
                        <div className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">
                          {draft.confidence ? `${Math.round(draft.confidence * 100)}%` : 'Pending'}
                        </div>
                      </div>
                    </summary>

                    <div className="mt-4 space-y-3">
                      {editorItems.length ? (
                        editorItems.map((item, index) => (
                          <div key={`${draft.id}-${index}`} className="rounded-[20px] bg-slate-50 p-3">
                            <div className="grid gap-3">
                              <LabelledInput label="Label" value={item.label} onChange={(value) => updatePhotoEditorItem(draft, index, 'label', value)} />
                              <div className="grid gap-3 sm:grid-cols-2">
                                <LabelledInput label="Grams" type="number" value={item.grams} onChange={(value) => updatePhotoEditorItem(draft, index, 'grams', value)} />
                                <LabelledInput label="Calories" type="number" value={item.calories} onChange={(value) => updatePhotoEditorItem(draft, index, 'calories', value)} />
                                <LabelledInput label="Protein" type="number" value={item.protein_g} onChange={(value) => updatePhotoEditorItem(draft, index, 'protein_g', value)} />
                                <LabelledInput label="Carbs" type="number" value={item.carbs_g} onChange={(value) => updatePhotoEditorItem(draft, index, 'carbs_g', value)} />
                                <LabelledInput label="Fat" type="number" value={item.fat_g} onChange={(value) => updatePhotoEditorItem(draft, index, 'fat_g', value)} />
                                <LabelledInput label="Fiber" type="number" value={item.fiber_g} onChange={(value) => updatePhotoEditorItem(draft, index, 'fiber_g', value)} />
                              </div>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="text-sm text-slate-500">{draft.error_message || 'Waiting for AI output'}</div>
                      )}

                      <div className="flex flex-col gap-2 sm:flex-row">
                        <ActionButton tone="secondary" onClick={() => rerunPhoto.mutate(draft.id)} className="w-full sm:w-auto">Re-run</ActionButton>
                        <ActionButton disabled={!canConfirm} onClick={() => confirmPhoto.mutate({ draftId: draft.id, items: editorItems })} className="w-full sm:w-auto">
                          Confirm meal
                        </ActionButton>
                      </div>
                    </div>
                  </details>
                )
              })}
              {!photosQuery.data?.items?.length ? <EmptyState title="No photo drafts yet" body="Upload a meal photo to start." /> : null}
            </div>
          </Panel>

          <Panel title="Recent meals" subtitle="Latest entries, kept close.">
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <LabelledSelect
                  label="Meal type"
                  value={mealFilters.meal_type}
                  onChange={(value) => setMealFilters((current) => ({ ...current, meal_type: value }))}
                  options={[
                    { label: 'All meal types', value: '' },
                    { label: 'Breakfast', value: 'breakfast' },
                    { label: 'Lunch', value: 'lunch' },
                    { label: 'Dinner', value: 'dinner' },
                    { label: 'Snack', value: 'snack' },
                    { label: 'Meal', value: 'meal' },
                  ]}
                />
                <LabelledInput label="From" type="date" value={mealFilters.date_from} onChange={(value) => setMealFilters((current) => ({ ...current, date_from: value }))} />
                <LabelledInput label="To" type="date" value={mealFilters.date_to} onChange={(value) => setMealFilters((current) => ({ ...current, date_to: value }))} />
              </div>
              {editingMealId ? (
                <DraftStatusBanner restored={mealEditorsState.meta.restored} savedAt={mealEditorsState.meta.savedAt} onDiscard={() => { setEditingMealId(null); mealEditorsState.meta.clearDraft() }} />
              ) : null}
              {mealsQuery.isLoading ? (
                <LoadingState title="Loading meals" body="Loading your meal history." />
              ) : mealsQuery.isError ? (
                <ErrorState title="Could not load meals" body={mealsQuery.error.message} action={<ActionButton onClick={() => mealsQuery.refetch()} className="w-auto">Retry</ActionButton>} />
              ) : (
                <div className="space-y-3">
                  {(mealsQuery.data?.items ?? []).map((meal) => (
                    <div key={meal.id} className="rounded-[22px] bg-slate-950 px-4 py-4 text-canvas">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="font-display text-xl">{meal.meal_type}</div>
                          <div className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-400">{new Date(meal.logged_at).toLocaleString()}</div>
                        </div>
                        <div className="rounded-full bg-white/10 px-3 py-2 text-sm">
                          {'sync_status' in meal && meal.sync_status === 'queued' ? 'Queued sync' : `${Math.round(meal.totals.calories)} kcal`}
                        </div>
                      </div>
                      <div className="mt-3 text-sm text-slate-300">{meal.items.map((item) => item.label).join(', ')}</div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <ActionButton tone="secondary" onClick={() => startEditingMeal(meal)} className="w-auto">Edit</ActionButton>
                        <ActionButton
                          tone="secondary"
                          onClick={() => setConfirmRequest({
                            title: 'Delete this meal?',
                            body: `Type ${meal.meal_type} to confirm deleting this entry.`,
                            confirmLabel: 'Delete meal',
                            confirmationValue: meal.meal_type,
                            confirmationHint: `Type ${meal.meal_type} to confirm`,
                            isPending: deleteMeal.isPending,
                            onConfirm: () => deleteMeal.mutate(meal.id),
                          })}
                          className="w-auto"
                        >
                          Delete
                        </ActionButton>
                      </div>
                      {editingMealId === meal.id ? (
                        <div className="mt-4 rounded-[20px] bg-white/10 p-4">
                          {(() => {
                            const editor = getMealEditor(meal)
                            const invalidEditor = !editor.meal_type || !editor.items.length || editor.items.some((item) => !item.label.trim() || Number(item.calories) < 0)
                            return (
                              <div className="space-y-3">
                                <div className="grid gap-3 sm:grid-cols-2">
                                  <LabelledSelect
                                    label="Meal type"
                                    value={editor.meal_type}
                                    onChange={(value) => updateMealEditor(meal.id, 'meal_type', value)}
                                    options={[
                                      { label: 'Breakfast', value: 'breakfast' },
                                      { label: 'Lunch', value: 'lunch' },
                                      { label: 'Dinner', value: 'dinner' },
                                      { label: 'Snack', value: 'snack' },
                                      { label: 'Meal', value: 'meal' },
                                    ]}
                                  />
                                  <LabelledInput
                                    label="Logged at"
                                    type="datetime-local"
                                    value={editor.logged_at}
                                    onChange={(value) => updateMealEditor(meal.id, 'logged_at', value)}
                                  />
                                </div>
                                <LabelledInput label="Notes" value={editor.notes} onChange={(value) => updateMealEditor(meal.id, 'notes', value)} />
                                {editor.items.map((item, index) => (
                                  <div key={`${meal.id}-${index}`} className="rounded-[18px] bg-slate-50 p-3 text-slate-900">
                                    <div className="grid gap-3">
                                      <LabelledInput label="Label" value={item.label} onChange={(value) => updateMealEditorItem(meal.id, index, 'label', value)} error={!item.label.trim() ? 'Item label is required.' : undefined} />
                                      <div className="grid gap-3 sm:grid-cols-2">
                                        <LabelledInput label="Grams" type="number" value={item.grams} onChange={(value) => updateMealEditorItem(meal.id, index, 'grams', value)} />
                                        <LabelledInput label="Calories" type="number" value={item.calories} onChange={(value) => updateMealEditorItem(meal.id, index, 'calories', value)} error={Number(item.calories) < 0 ? 'Calories cannot be negative.' : undefined} />
                                        <LabelledInput label="Protein" type="number" value={item.protein_g} onChange={(value) => updateMealEditorItem(meal.id, index, 'protein_g', value)} />
                                        <LabelledInput label="Carbs" type="number" value={item.carbs_g} onChange={(value) => updateMealEditorItem(meal.id, index, 'carbs_g', value)} />
                                        <LabelledInput label="Fat" type="number" value={item.fat_g} onChange={(value) => updateMealEditorItem(meal.id, index, 'fat_g', value)} />
                                        <LabelledInput label="Fiber" type="number" value={item.fiber_g} onChange={(value) => updateMealEditorItem(meal.id, index, 'fiber_g', value)} />
                                      </div>
                                    </div>
                                  </div>
                                ))}
                                <div className="flex flex-wrap gap-2">
                                  <ActionButton
                                    tone="secondary"
                                    onClick={() => setMealEditors((state) => ({
                                      ...state,
                                      [meal.id]: {
                                        ...getMealEditor(meal),
                                        items: [...getMealEditor(meal).items, { label: '', grams: '', calories: '0', protein_g: '0', carbs_g: '0', fat_g: '0', fiber_g: '0', sodium_mg: '0', source_type: 'manual' }],
                                      },
                                    }))}
                                    className="w-auto"
                                  >
                                    Add item
                                  </ActionButton>
                                  <ActionButton
                                    onClick={() => updateMeal.mutate({
                                      mealId: meal.id,
                                      payload: {
                                        meal_type: editor.meal_type,
                                        logged_at: editor.logged_at ? new Date(editor.logged_at).toISOString() : meal.logged_at,
                                        notes: editor.notes || undefined,
                                        source: 'manual',
                                        items: editor.items.map((item) => ({
                                          label: item.label,
                                          grams: item.grams ? Number(item.grams) : null,
                                          calories: Number(item.calories),
                                          protein_g: Number(item.protein_g),
                                          carbs_g: Number(item.carbs_g),
                                          fat_g: Number(item.fat_g),
                                          fiber_g: Number(item.fiber_g),
                                          sodium_mg: Number(item.sodium_mg),
                                          source_type: item.source_type,
                                        })),
                                      },
                                    })}
                                    className="w-auto"
                                    disabled={invalidEditor || updateMeal.isPending}
                                  >
                                    {updateMeal.isPending ? 'Saving...' : 'Save changes'}
                                  </ActionButton>
                                  <ActionButton tone="secondary" onClick={() => setEditingMealId(null)} className="w-auto">Cancel</ActionButton>
                                </div>
                              </div>
                            )
                          })()}
                        </div>
                      ) : null}
                    </div>
                  ))}
                  {!mealsQuery.data?.items?.length ? <EmptyState title="No meals yet" body="Use the quick log, repeats, or photo log to start." /> : null}
                  {mealsQuery.data?.has_more ? (
                    <ActionButton tone="secondary" onClick={() => setMealLimit((current) => current + 10)} className="w-full sm:w-auto">
                      Load more meals
                    </ActionButton>
                  ) : null}
                </div>
              )}
            </div>
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="Favorite foods" subtitle="Keep staples within reach.">
            {favoriteFoodsQuery.isLoading ? (
              <LoadingState title="Loading favorite foods" body="Loading your saved staples." />
            ) : favoriteFoodsQuery.isError ? (
              <ErrorState title="Could not load favorite foods" body={favoriteFoodsQuery.error.message} action={<ActionButton onClick={() => favoriteFoodsQuery.refetch()} className="w-auto">Retry</ActionButton>} />
            ) : (
              <div className="space-y-3">
                {favoriteFoods.map((food) => (
                  <div key={food.id} className="rounded-[22px] border border-slate-200 bg-white p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-slate-950">{food.name}</div>
                        <div className="mt-1 text-sm text-slate-500">{food.calories} kcal, {food.protein_g}P / {food.carbs_g}C / {food.fat_g}F</div>
                      </div>
                      <ActionButton tone="secondary" onClick={() => toggleFavoriteFood.mutate({ foodId: food.id, isFavorite: false })} className="w-auto">
                        Unfavorite
                      </ActionButton>
                    </div>
                  </div>
                ))}
                {!favoriteFoods.length ? <EmptyState title="No favorite foods yet" body="Favorite a few foods to pin them here." /> : null}
              </div>
            )}
          </Panel>

          <details className="rounded-[24px] border border-slate-200 bg-white/90 shadow-halo" open={false}>
            <summary className="cursor-pointer list-none px-4 py-4">
              <div className="font-display text-xl text-slate-950">Advanced recipe builder</div>
              <div className="mt-1 text-sm text-slate-500">For saved recipes and meal prep.</div>
            </summary>
            <div className="border-t border-slate-200 px-4 py-4">
              <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); if (!recipeError) { createRecipe.mutate() } }}>
                <DraftStatusBanner restored={recipeDraftState.meta.restored} savedAt={recipeDraftState.meta.savedAt} onDiscard={recipeDraftState.meta.clearDraft} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <LabelledInput label="Recipe name" value={recipeDraft.name} onChange={(value) => setRecipeDraft((current) => ({ ...current, name: value }))} />
                  <LabelledInput label="Servings" type="number" value={recipeDraft.servings} onChange={(value) => setRecipeDraft((current) => ({ ...current, servings: value }))} />
                </div>
                <LabelledInput label="Search foods" value={foodSearch} onChange={setFoodSearch} placeholder="Search saved foods" />
                {recipeDraft.items.map((item, index) => (
                  <div key={index} className="grid gap-3 rounded-[20px] bg-slate-50 p-3 sm:grid-cols-[minmax(0,1fr)_120px]">
                    <LabelledSelect
                      label="Ingredient"
                      value={item.food_id}
                      onChange={(value) => {
                        const next = [...recipeDraft.items]
                        next[index] = { ...next[index], food_id: value }
                        setRecipeDraft((current) => ({ ...current, items: next }))
                      }}
                      options={[
                        { label: 'Select food', value: '' },
                        ...favoriteFoods.map((food) => ({ label: `${food.name} (favorite)`, value: food.id })),
                        ...searchFoods
                          .filter((food) => !favoriteFoods.some((favorite) => favorite.id === food.id))
                          .map((food) => ({ label: food.name, value: food.id })),
                      ]}
                    />
                    <LabelledInput label="Grams" type="number" value={item.grams} onChange={(value) => {
                      const next = [...recipeDraft.items]
                      next[index] = { ...next[index], grams: value }
                      setRecipeDraft((current) => ({ ...current, items: next }))
                    }} />
                  </div>
                ))}
                <div className="flex flex-col gap-2 sm:flex-row">
                  <ActionButton tone="secondary" onClick={() => setRecipeDraft((current) => ({ ...current, items: [...current.items, { food_id: '', grams: '100' }] }))} className="w-full sm:w-auto">Add ingredient</ActionButton>
                  <ActionButton type="submit" className="w-full sm:w-auto" disabled={createRecipe.isPending || Boolean(recipeError)}>{createRecipe.isPending ? 'Saving...' : 'Save recipe'}</ActionButton>
                </div>
                {recipeError ? <div className="app-status app-status-danger rounded-[22px] px-4 py-3 text-sm">{recipeError}</div> : null}
              </form>
            </div>
          </details>

          <details className="rounded-[24px] border border-slate-200 bg-white/90 shadow-halo" open={false}>
            <summary className="cursor-pointer list-none px-4 py-4">
              <div className="font-display text-xl text-slate-950">Food library</div>
              <div className="mt-1 text-sm text-slate-500">Save foods once, reuse them anywhere.</div>
            </summary>
            <div className="border-t border-slate-200 px-4 py-4">
              <div className="mb-4 rounded-[20px] bg-slate-50 p-4">
                <div className="font-semibold text-slate-950">Faster imports</div>
                <div className="mt-1 text-sm text-slate-500">Use a barcode or label photo to prefill. Uploads still need a connection.</div>
                <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <LabelledInput label="Barcode" value={barcodeDraft} onChange={setBarcodeDraft} placeholder="0123456789012" />
                  <ActionButton onClick={() => importBarcode.mutate()} className="sm:self-end">{importBarcode.isPending ? 'Looking up...' : 'Lookup barcode'}</ActionButton>
                </div>
                <div className="mt-3">
                  <label className="inline-flex cursor-pointer items-center justify-center rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-900 ring-1 ring-slate-200">
                    Scan nutrition label
                    <input type="file" accept="image/*" className="hidden" onChange={(event) => {
                      const file = event.target.files?.[0]
                      if (file) scanLabel.mutate(file)
                    }} />
                  </label>
                </div>
                {importStatus ? <div className="app-status app-status-warning mt-3 rounded-2xl px-4 py-3 text-sm">{importStatus}</div> : null}
              </div>
              <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); if (!Object.values(foodErrors).some(Boolean)) { saveFood.mutate() } }}>
                <div className="sm:col-span-2">
                  <DraftStatusBanner restored={foodDraftState.meta.restored} savedAt={foodDraftState.meta.savedAt} onDiscard={() => { setEditingFoodId(null); foodDraftState.meta.clearDraft() }} />
                </div>
                <div className="sm:col-span-2"><LabelledInput label="Food name" value={foodDraft.name} onChange={(value) => setFoodDraft((current) => ({ ...current, name: value }))} error={foodErrors.name || undefined} /></div>
                <LabelledInput label="Brand" value={foodDraft.brand} onChange={(value) => setFoodDraft((current) => ({ ...current, brand: value }))} />
                <LabelledInput label="Serving label" value={foodDraft.serving_name} onChange={(value) => setFoodDraft((current) => ({ ...current, serving_name: value }))} />
                <LabelledInput label="Calories /100g" type="number" value={foodDraft.calories} onChange={(value) => setFoodDraft((current) => ({ ...current, calories: value }))} error={foodErrors.calories || undefined} />
                <LabelledInput label="Protein /100g" type="number" value={foodDraft.protein_g} onChange={(value) => setFoodDraft((current) => ({ ...current, protein_g: value }))} error={foodErrors.protein_g || undefined} />
                <LabelledInput label="Carbs /100g" type="number" value={foodDraft.carbs_g} onChange={(value) => setFoodDraft((current) => ({ ...current, carbs_g: value }))} error={foodErrors.carbs_g || undefined} />
                <LabelledInput label="Fat /100g" type="number" value={foodDraft.fat_g} onChange={(value) => setFoodDraft((current) => ({ ...current, fat_g: value }))} error={foodErrors.fat_g || undefined} />
                <LabelledInput label="Fiber /100g" type="number" value={foodDraft.fiber_g} onChange={(value) => setFoodDraft((current) => ({ ...current, fiber_g: value }))} />
                <LabelledInput label="Sugar /100g" type="number" value={foodDraft.sugar_g} onChange={(value) => setFoodDraft((current) => ({ ...current, sugar_g: value }))} />
                <LabelledInput label="Sodium mg /100g" type="number" value={foodDraft.sodium_mg} onChange={(value) => setFoodDraft((current) => ({ ...current, sodium_mg: value }))} />
                <div className="sm:col-span-2"><LabelledInput label="Notes" value={foodDraft.notes} onChange={(value) => setFoodDraft((current) => ({ ...current, notes: value }))} /></div>
                <div className="sm:col-span-2 flex flex-wrap gap-2">
                  <ActionButton type="submit" className="sm:w-auto" disabled={saveFood.isPending || Object.values(foodErrors).some(Boolean)}>
                    {saveFood.isPending ? 'Saving...' : editingFoodId ? 'Save food changes' : 'Save food'}
                  </ActionButton>
                  {editingFoodId ? <ActionButton tone="secondary" onClick={() => { setEditingFoodId(null); foodDraftState.meta.clearDraft() }} className="sm:w-auto">Cancel edit</ActionButton> : null}
                </div>
              </form>
              <div className="mt-4">
                <LabelledInput label="Search foods" value={foodSearch} onChange={setFoodSearch} placeholder="Search by name or brand" />
              </div>
              <div className="mt-4 space-y-2">
                {foodsQuery.isLoading ? (
                  <LoadingState title="Searching foods" body="Loading matches." />
                ) : foodsQuery.isError ? (
                  <ErrorState title="Could not search foods" body={foodsQuery.error.message} action={<ActionButton onClick={() => foodsQuery.refetch()} className="w-auto">Retry</ActionButton>} />
                ) : searchFoods.slice(0, 8).map((food) => (
                  <div key={food.id} className="rounded-2xl bg-slate-50 px-4 py-3 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-slate-950">{food.name}</div>
                        <div className="mt-1 text-slate-500">{food.calories} kcal, {food.protein_g}P / {food.carbs_g}C / {food.fat_g}F</div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <ActionButton tone="secondary" onClick={() => startEditingFood(food)} className="w-auto">Edit</ActionButton>
                        <ActionButton tone="secondary" onClick={() => toggleFavoriteFood.mutate({ foodId: food.id, isFavorite: !food.is_favorite })} className="w-auto">
                          {food.is_favorite ? 'Unfavorite' : 'Favorite'}
                        </ActionButton>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </details>
        </div>
      </div>

      <ConfirmSheet request={confirmRequest} onClose={() => setConfirmRequest(null)} />
    </div>
  )
}
