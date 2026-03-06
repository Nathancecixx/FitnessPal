import { useMutation, useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { ActionButton, DataList, EmptyState, LabelledInput, PageIntro, Panel } from '../../components/ui'
import { api } from '../../lib/api'
import { queryClient } from '../../lib/query-client'

export function NutritionPage() {
  const foodsQuery = useQuery({ queryKey: ['foods'], queryFn: () => api.listFoods() })
  const mealsQuery = useQuery({ queryKey: ['meals'], queryFn: api.listMeals })
  const templatesQuery = useQuery({ queryKey: ['meal-templates'], queryFn: api.listMealTemplates })
  const photosQuery = useQuery({ queryKey: ['meal-photos'], queryFn: api.listMealPhotos })

  const [foodDraft, setFoodDraft] = useState({ name: '', calories: '165', protein_g: '31', carbs_g: '0', fat_g: '3.6' })
  const [quickMeal, setQuickMeal] = useState({ label: 'Quick meal', calories: '650', protein_g: '45', carbs_g: '60', fat_g: '20', meal_type: 'lunch' })
  const [photoStatus, setPhotoStatus] = useState<string>('')

  const createFood = useMutation({
    mutationFn: () => api.createFood({
      name: foodDraft.name,
      calories: Number(foodDraft.calories),
      protein_g: Number(foodDraft.protein_g),
      carbs_g: Number(foodDraft.carbs_g),
      fat_g: Number(foodDraft.fat_g),
    }),
    onSuccess: async () => {
      setFoodDraft({ name: '', calories: '165', protein_g: '31', carbs_g: '0', fat_g: '3.6' })
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
    }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['meals'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['insights'] }),
      ])
    },
  })

  const uploadPhoto = useMutation({
    mutationFn: async (file: File) => api.uploadMealPhoto(file),
    onMutate: () => setPhotoStatus('Uploading and scheduling analysis...'),
    onSuccess: async () => {
      setPhotoStatus('Photo queued. Check drafts below for AI estimates.')
      await queryClient.invalidateQueries({ queryKey: ['meal-photos'] })
    },
    onError: (error) => setPhotoStatus(error.message),
  })

  const favoriteFoods = useMemo(() => (foodsQuery.data?.items ?? []).slice(0, 6), [foodsQuery.data?.items])

  return (
    <div className="space-y-4">
      <PageIntro
        eyebrow="Nutrition"
        title="Manual logging, templates, and photo drafts"
        description="Track meals with quick macros, reusable foods, and local photo analysis drafts. The UI stays optimized for fast keyboard entry on desktop and camera-first capture on mobile."
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_380px]">
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Quick meal log" subtitle="Fastest path for manual macros or a rough estimate.">
              <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); createQuickMeal.mutate() }}>
                <div className="sm:col-span-2"><LabelledInput label="Label" value={quickMeal.label} onChange={(value) => setQuickMeal((current) => ({ ...current, label: value }))} /></div>
                <LabelledInput label="Meal type" value={quickMeal.meal_type} onChange={(value) => setQuickMeal((current) => ({ ...current, meal_type: value }))} />
                <LabelledInput label="Calories" type="number" value={quickMeal.calories} onChange={(value) => setQuickMeal((current) => ({ ...current, calories: value }))} />
                <LabelledInput label="Protein" type="number" value={quickMeal.protein_g} onChange={(value) => setQuickMeal((current) => ({ ...current, protein_g: value }))} />
                <LabelledInput label="Carbs" type="number" value={quickMeal.carbs_g} onChange={(value) => setQuickMeal((current) => ({ ...current, carbs_g: value }))} />
                <LabelledInput label="Fat" type="number" value={quickMeal.fat_g} onChange={(value) => setQuickMeal((current) => ({ ...current, fat_g: value }))} />
                <ActionButton type="submit" className="sm:col-span-2">Log meal</ActionButton>
              </form>
            </Panel>
            <Panel title="Food catalog" subtitle="Build your local ingredient library once, reuse it forever.">
              <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); createFood.mutate() }}>
                <div className="sm:col-span-2"><LabelledInput label="Food name" value={foodDraft.name} onChange={(value) => setFoodDraft((current) => ({ ...current, name: value }))} /></div>
                <LabelledInput label="Calories /100g" type="number" value={foodDraft.calories} onChange={(value) => setFoodDraft((current) => ({ ...current, calories: value }))} />
                <LabelledInput label="Protein /100g" type="number" value={foodDraft.protein_g} onChange={(value) => setFoodDraft((current) => ({ ...current, protein_g: value }))} />
                <LabelledInput label="Carbs /100g" type="number" value={foodDraft.carbs_g} onChange={(value) => setFoodDraft((current) => ({ ...current, carbs_g: value }))} />
                <LabelledInput label="Fat /100g" type="number" value={foodDraft.fat_g} onChange={(value) => setFoodDraft((current) => ({ ...current, fat_g: value }))} />
                <ActionButton type="submit" className="sm:col-span-2">Save food</ActionButton>
              </form>
              <div className="mt-4 space-y-2">
                {favoriteFoods.map((food) => (
                  <div key={food.id} className="rounded-2xl bg-slate-100 px-4 py-3 text-sm">
                    <div className="font-semibold text-slate-950">{food.name}</div>
                    <div className="mt-1 text-slate-500">{food.calories} kcal, {food.protein_g}P / {food.carbs_g}C / {food.fat_g}F</div>
                  </div>
                ))}
              </div>
            </Panel>
          </div>

          <Panel title="Recent meals" subtitle="Latest logs across manual entry, templates, recipes, and photo-confirmed meals.">
            <div className="grid gap-3">
              {(mealsQuery.data?.items ?? []).slice(0, 6).map((meal) => (
                <div key={meal.id} className="rounded-[24px] bg-slate-950 px-4 py-4 text-canvas">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-display text-xl">{meal.meal_type}</div>
                      <div className="text-xs uppercase tracking-[0.2em] text-slate-400">{new Date(meal.logged_at).toLocaleString()}</div>
                    </div>
                    <div className="rounded-full bg-white/10 px-3 py-2 text-sm">{Math.round(meal.totals.calories)} kcal</div>
                  </div>
                  <div className="mt-3 text-sm text-slate-300">{meal.items.map((item) => item.label).join(', ')}</div>
                </div>
              ))}
              {!mealsQuery.data?.items?.length ? <EmptyState title="No meals yet" body="Use the quick meal form, save foods first, or upload a meal photo to start the log." /> : null}
            </div>
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="Photo meal analysis" subtitle="Send a meal photo and review the AI draft before it becomes a real log.">
            <label className="flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-[28px] border border-dashed border-slate-300 bg-slate-50 text-center text-sm text-slate-500">
              <span className="font-display text-2xl text-slate-800">Drop a plate photo</span>
              <span className="mt-2 max-w-xs leading-6">The backend queues a local AI analysis job and stores an editable draft with explicit confidence fields.</span>
              <input type="file" accept="image/*" className="hidden" onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) uploadPhoto.mutate(file)
              }} />
            </label>
            {photoStatus ? <div className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900">{photoStatus}</div> : null}
            <div className="space-y-3">
              {(photosQuery.data?.items ?? []).slice(0, 4).map((draft) => (
                <div key={draft.id} className="rounded-[24px] border border-slate-200 bg-white px-4 py-4 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold text-slate-950">{draft.status}</span>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs">{draft.confidence ? `${Math.round(draft.confidence * 100)}% confidence` : 'Pending'}</span>
                  </div>
                  <div className="mt-3 text-slate-500">{draft.candidates.map((item) => item.label).join(', ') || 'Waiting for AI output'}</div>
                </div>
              ))}
              {!photosQuery.data?.items?.length ? <EmptyState title="No photo drafts" body="Upload a food image from mobile or desktop to test the local vision pipeline." /> : null}
            </div>
          </Panel>

          <Panel title="Saved meal templates" subtitle="Common meals you want to re-log without friction.">
            <DataList rows={(templatesQuery.data?.items ?? []).slice(0, 6).map((template) => ({ label: template.name, value: `${Math.round(template.totals.calories)} kcal` }))} />
            {!templatesQuery.data?.items?.length ? <div className="mt-3"><EmptyState title="No templates yet" body="Use the Templates tab to create repeatable meal presets for your staples." /></div> : null}
          </Panel>
        </div>
      </div>
    </div>
  )
}
