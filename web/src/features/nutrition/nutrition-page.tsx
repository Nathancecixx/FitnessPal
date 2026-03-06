import { useMutation, useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { ActionButton, EmptyState, LabelledInput, LabelledSelect, PageIntro, Panel } from '../../components/ui'
import { api, type FoodImportDraft, type MealEntry, type MealEntryItem, type MealPhotoDraft } from '../../lib/api'
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

export function NutritionPage() {
  const foodsQuery = useQuery({ queryKey: ['foods'], queryFn: () => api.listFoods() })
  const recipesQuery = useQuery({ queryKey: ['recipes'], queryFn: api.listRecipes })
  const mealsQuery = useQuery({ queryKey: ['meals'], queryFn: api.listMeals })
  const templatesQuery = useQuery({ queryKey: ['meal-templates'], queryFn: api.listMealTemplates })
  const photosQuery = useQuery({
    queryKey: ['meal-photos'],
    queryFn: api.listMealPhotos,
    refetchInterval: (query) => {
      const drafts = query.state.data?.items ?? []
      return drafts.some((draft) => draft.status === 'queued' || draft.status === 'processing') ? 3000 : false
    },
  })

  const [foodDraft, setFoodDraft] = useState({
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
  })
  const [barcodeDraft, setBarcodeDraft] = useState('')
  const [importStatus, setImportStatus] = useState('')
  const [quickMeal, setQuickMeal] = useState({ label: 'Quick meal', calories: '650', protein_g: '45', carbs_g: '60', fat_g: '20', meal_type: 'lunch', notes: '' })
  const [recipeDraft, setRecipeDraft] = useState({
    name: 'Chicken rice bowl',
    servings: '1',
    items: [{ food_id: '', grams: '180' }],
  })
  const [photoStatus, setPhotoStatus] = useState<string>('')
  const [photoEditors, setPhotoEditors] = useState<Record<string, DraftEditorItem[]>>({})
  const [mealEditors, setMealEditors] = useState<Record<string, EditableMealDraft>>({})
  const [editingMealId, setEditingMealId] = useState<string | null>(null)

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

  const createFood = useMutation({
    mutationFn: () => api.createFood({
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
    }),
    onSuccess: async () => {
      setFoodDraft({
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
      })
      await queryClient.invalidateQueries({ queryKey: ['foods'] })
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
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['meals'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['insights'] }),
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
      setRecipeDraft({ name: 'Chicken rice bowl', servings: '1', items: [{ food_id: '', grams: '180' }] })
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
    onSuccess: async () => {
      setPhotoStatus('Draft confirmed and saved as a meal.')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['meal-photos'] }),
        queryClient.invalidateQueries({ queryKey: ['meals'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['insights'] }),
      ])
    },
    onError: (error) => setPhotoStatus(error.message),
  })

  const updateMeal = useMutation({
    mutationFn: ({ mealId, payload }: { mealId: string; payload: Record<string, unknown> }) => api.updateMeal(mealId, payload),
    onSuccess: async () => {
      setEditingMealId(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['meals'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['insights'] }),
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
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['meals'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['insights'] }),
      ])
    },
  })

  const favoriteFoods = useMemo(() => (foodsQuery.data?.items ?? []).slice(0, 6), [foodsQuery.data?.items])
  const repeatRecipes = useMemo(() => (recipesQuery.data?.items ?? []).slice(0, 3), [recipesQuery.data?.items])
  const repeatTemplates = useMemo(() => (templatesQuery.data?.items ?? []).slice(0, 3), [templatesQuery.data?.items])

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

  return (
    <div className="space-y-4">
      <PageIntro
        eyebrow="Nutrition"
        title="Quick food logging first"
        description="Keep the daily meal flow fast on your phone, then open the deeper recipe and food tools only when you want more control."
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <div className="space-y-4">
          <Panel title="Fast meal log" subtitle="Manual macros for the days when speed matters more than perfect detail.">
            <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); createQuickMeal.mutate() }}>
              <div className="sm:col-span-2"><LabelledInput label="Meal label" value={quickMeal.label} onChange={(value) => setQuickMeal((current) => ({ ...current, label: value }))} /></div>
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
              <LabelledInput label="Calories" type="number" value={quickMeal.calories} onChange={(value) => setQuickMeal((current) => ({ ...current, calories: value }))} />
              <LabelledInput label="Protein" type="number" value={quickMeal.protein_g} onChange={(value) => setQuickMeal((current) => ({ ...current, protein_g: value }))} />
              <LabelledInput label="Carbs" type="number" value={quickMeal.carbs_g} onChange={(value) => setQuickMeal((current) => ({ ...current, carbs_g: value }))} />
              <LabelledInput label="Fat" type="number" value={quickMeal.fat_g} onChange={(value) => setQuickMeal((current) => ({ ...current, fat_g: value }))} />
              <div className="sm:col-span-2"><LabelledInput label="Notes" value={quickMeal.notes} onChange={(value) => setQuickMeal((current) => ({ ...current, notes: value }))} /></div>
              <ActionButton type="submit" className="sm:col-span-2 sm:w-auto">Save meal</ActionButton>
            </form>
          </Panel>

          <Panel title="Photo log" subtitle="Upload first, correct second, save when the guess looks right.">
            <label className="flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-[24px] border border-dashed border-slate-300 bg-slate-50 px-4 text-center text-sm text-slate-500">
              <span className="font-display text-2xl text-slate-800">Take or choose a food photo</span>
              <span className="mt-2 max-w-xs leading-6">This is tuned for phone use. The worker stores a draft so you can fix labels or macros before saving.</span>
              <input type="file" accept="image/*" className="hidden" onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) uploadPhoto.mutate(file)
              }} />
            </label>
            {photoStatus ? <div className="mt-3 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900">{photoStatus}</div> : null}

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
              {!photosQuery.data?.items?.length ? <EmptyState title="No photo drafts yet" body="Upload a meal photo from your phone to test the fastest AI-assisted flow." /> : null}
            </div>
          </Panel>

          <Panel title="Recent meals" subtitle="Your latest entries stay visible so you can sanity-check the day quickly.">
            <div className="space-y-3">
              {(mealsQuery.data?.items ?? []).slice(0, 5).map((meal) => (
                <div key={meal.id} className="rounded-[22px] bg-slate-950 px-4 py-4 text-canvas">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-display text-xl">{meal.meal_type}</div>
                      <div className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-400">{new Date(meal.logged_at).toLocaleString()}</div>
                    </div>
                    <div className="rounded-full bg-white/10 px-3 py-2 text-sm">{Math.round(meal.totals.calories)} kcal</div>
                  </div>
                  <div className="mt-3 text-sm text-slate-300">{meal.items.map((item) => item.label).join(', ')}</div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <ActionButton tone="secondary" onClick={() => startEditingMeal(meal)} className="w-auto">Edit</ActionButton>
                    <ActionButton tone="secondary" onClick={() => deleteMeal.mutate(meal.id)} className="w-auto">Delete</ActionButton>
                  </div>
                  {editingMealId === meal.id ? (
                    <div className="mt-4 rounded-[20px] bg-white/10 p-4">
                      {(() => {
                        const editor = getMealEditor(meal)
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
                                  <LabelledInput label="Label" value={item.label} onChange={(value) => updateMealEditorItem(meal.id, index, 'label', value)} />
                                  <div className="grid gap-3 sm:grid-cols-2">
                                    <LabelledInput label="Grams" type="number" value={item.grams} onChange={(value) => updateMealEditorItem(meal.id, index, 'grams', value)} />
                                    <LabelledInput label="Calories" type="number" value={item.calories} onChange={(value) => updateMealEditorItem(meal.id, index, 'calories', value)} />
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
                              >
                                Save changes
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
              {!mealsQuery.data?.items?.length ? <EmptyState title="No meals yet" body="Use the quick log, a saved repeat, or a food photo to start building your day." /> : null}
            </div>
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="Repeat favorites" subtitle="The stuff you eat all the time should be one tap away.">
            <div className="space-y-3">
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
              {!repeatRecipes.length && !repeatTemplates.length ? <EmptyState title="No quick repeats yet" body="Saved recipes and templates will show up here for fast everyday logging." /> : null}
            </div>
          </Panel>

          <details className="rounded-[24px] border border-slate-200 bg-white/90 shadow-halo" open={false}>
            <summary className="cursor-pointer list-none px-4 py-4">
              <div className="font-display text-xl text-slate-950">Advanced recipe builder</div>
              <div className="mt-1 text-sm text-slate-500">Ingredient math for meal prep, custom dishes, and more detailed tracking.</div>
            </summary>
            <div className="border-t border-slate-200 px-4 py-4">
              <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); createRecipe.mutate() }}>
                <div className="grid gap-3 sm:grid-cols-2">
                  <LabelledInput label="Recipe name" value={recipeDraft.name} onChange={(value) => setRecipeDraft((current) => ({ ...current, name: value }))} />
                  <LabelledInput label="Servings" type="number" value={recipeDraft.servings} onChange={(value) => setRecipeDraft((current) => ({ ...current, servings: value }))} />
                </div>
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
                        ...(foodsQuery.data?.items ?? []).map((food) => ({ label: food.name, value: food.id })),
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
                  <ActionButton type="submit" className="w-full sm:w-auto">Save recipe</ActionButton>
                </div>
              </form>
            </div>
          </details>

          <details className="rounded-[24px] border border-slate-200 bg-white/90 shadow-halo" open={false}>
            <summary className="cursor-pointer list-none px-4 py-4">
              <div className="font-display text-xl text-slate-950">Food library</div>
              <div className="mt-1 text-sm text-slate-500">Build your own staple ingredient list once, then reuse it everywhere.</div>
            </summary>
            <div className="border-t border-slate-200 px-4 py-4">
              <div className="mb-4 rounded-[20px] bg-slate-50 p-4">
                <div className="font-semibold text-slate-950">Faster imports</div>
                <div className="mt-1 text-sm text-slate-500">Use a barcode or nutrition-label photo to prefill the food draft.</div>
                <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <LabelledInput label="Barcode" value={barcodeDraft} onChange={setBarcodeDraft} placeholder="0123456789012" />
                  <ActionButton onClick={() => importBarcode.mutate()} className="sm:self-end">{importBarcode.isPending ? 'Looking up…' : 'Lookup barcode'}</ActionButton>
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
                {importStatus ? <div className="mt-3 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900">{importStatus}</div> : null}
              </div>
              <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); createFood.mutate() }}>
                <div className="sm:col-span-2"><LabelledInput label="Food name" value={foodDraft.name} onChange={(value) => setFoodDraft((current) => ({ ...current, name: value }))} /></div>
                <LabelledInput label="Brand" value={foodDraft.brand} onChange={(value) => setFoodDraft((current) => ({ ...current, brand: value }))} />
                <LabelledInput label="Serving label" value={foodDraft.serving_name} onChange={(value) => setFoodDraft((current) => ({ ...current, serving_name: value }))} />
                <LabelledInput label="Calories /100g" type="number" value={foodDraft.calories} onChange={(value) => setFoodDraft((current) => ({ ...current, calories: value }))} />
                <LabelledInput label="Protein /100g" type="number" value={foodDraft.protein_g} onChange={(value) => setFoodDraft((current) => ({ ...current, protein_g: value }))} />
                <LabelledInput label="Carbs /100g" type="number" value={foodDraft.carbs_g} onChange={(value) => setFoodDraft((current) => ({ ...current, carbs_g: value }))} />
                <LabelledInput label="Fat /100g" type="number" value={foodDraft.fat_g} onChange={(value) => setFoodDraft((current) => ({ ...current, fat_g: value }))} />
                <LabelledInput label="Fiber /100g" type="number" value={foodDraft.fiber_g} onChange={(value) => setFoodDraft((current) => ({ ...current, fiber_g: value }))} />
                <LabelledInput label="Sugar /100g" type="number" value={foodDraft.sugar_g} onChange={(value) => setFoodDraft((current) => ({ ...current, sugar_g: value }))} />
                <LabelledInput label="Sodium mg /100g" type="number" value={foodDraft.sodium_mg} onChange={(value) => setFoodDraft((current) => ({ ...current, sodium_mg: value }))} />
                <div className="sm:col-span-2"><LabelledInput label="Notes" value={foodDraft.notes} onChange={(value) => setFoodDraft((current) => ({ ...current, notes: value }))} /></div>
                <ActionButton type="submit" className="sm:col-span-2 sm:w-auto">Save food</ActionButton>
              </form>
              <div className="mt-4 space-y-2">
                {favoriteFoods.map((food) => (
                  <div key={food.id} className="rounded-2xl bg-slate-50 px-4 py-3 text-sm">
                    <div className="font-semibold text-slate-950">{food.name}</div>
                    <div className="mt-1 text-slate-500">{food.calories} kcal, {food.protein_g}P / {food.carbs_g}C / {food.fat_g}F</div>
                  </div>
                ))}
              </div>
            </div>
          </details>
        </div>
      </div>
    </div>
  )
}
