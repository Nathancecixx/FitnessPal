import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { ActionButton, EmptyState, LabelledInput, LabelledSelect, LabelledTextArea, PageIntro, Panel } from '../../components/ui'
import { api } from '../../lib/api'
import { queryClient } from '../../lib/query-client'

export function TemplatesPage() {
  const foodsQuery = useQuery({ queryKey: ['foods'], queryFn: () => api.listFoods() })
  const exercisesQuery = useQuery({ queryKey: ['exercises'], queryFn: api.listExercises })
  const mealTemplatesQuery = useQuery({ queryKey: ['meal-templates'], queryFn: api.listMealTemplates })
  const workoutTemplatesQuery = useQuery({ queryKey: ['workout-templates'], queryFn: api.listWorkoutTemplates })

  const [mealTemplateDraft, setMealTemplateDraft] = useState({
    name: '',
    meal_type: 'meal',
    notes: '',
    items: [{ food_id: '', label: '', grams: '180', calories: '0', protein_g: '0', carbs_g: '0', fat_g: '0' }],
  })
  const [workoutTemplateDraft, setWorkoutTemplateDraft] = useState({
    name: '',
    notes: '',
    items: [{ exercise_id: '', target_sets: '3', target_reps_min: '6', target_reps_max: '10', rest_seconds: '120' }],
  })

  const createMealTemplate = useMutation({
    mutationFn: () => api.createMealTemplate({
      name: mealTemplateDraft.name,
      meal_type: mealTemplateDraft.meal_type,
      notes: mealTemplateDraft.notes,
      items: mealTemplateDraft.items.map((item) => ({
        food_id: item.food_id || null,
        label: item.label,
        grams: item.grams ? Number(item.grams) : null,
        calories: item.food_id ? undefined : Number(item.calories),
        protein_g: item.food_id ? undefined : Number(item.protein_g),
        carbs_g: item.food_id ? undefined : Number(item.carbs_g),
        fat_g: item.food_id ? undefined : Number(item.fat_g),
        source_type: item.food_id ? 'food' : 'manual',
      })),
    }),
    onSuccess: async () => {
      setMealTemplateDraft({
        name: '',
        meal_type: 'meal',
        notes: '',
        items: [{ food_id: '', label: '', grams: '180', calories: '0', protein_g: '0', carbs_g: '0', fat_g: '0' }],
      })
      await queryClient.invalidateQueries({ queryKey: ['meal-templates'] })
    },
  })

  const createWorkoutTemplate = useMutation({
    mutationFn: () => api.createWorkoutTemplate({
      name: workoutTemplateDraft.name,
      notes: workoutTemplateDraft.notes,
      items: workoutTemplateDraft.items
        .filter((item) => item.exercise_id)
        .map((item, index) => ({
          exercise_id: item.exercise_id,
          order_index: index,
          target_sets: Number(item.target_sets),
          target_reps_min: Number(item.target_reps_min),
          target_reps_max: Number(item.target_reps_max),
          rest_seconds: Number(item.rest_seconds),
        })),
    }),
    onSuccess: async () => {
      setWorkoutTemplateDraft({
        name: '',
        notes: '',
        items: [{ exercise_id: '', target_sets: '3', target_reps_min: '6', target_reps_max: '10', rest_seconds: '120' }],
      })
      await queryClient.invalidateQueries({ queryKey: ['workout-templates'] })
    },
  })

  return (
    <div className="space-y-4">
      <PageIntro
        eyebrow="Templates"
        title="Save the repeatable stuff once"
        description="Keep your common meals and gym sessions ready for one-tap reuse. Building templates is setup work, so the builders stay tucked away until you need them."
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="space-y-4">
          <Panel title="Meal templates" subtitle="These feed the fast log on the Nutrition page.">
            <div className="space-y-3">
              {(mealTemplatesQuery.data?.items ?? []).map((template) => (
                <div key={template.id} className="rounded-[24px] bg-slate-950 px-4 py-4 text-canvas">
                  <div className="font-display text-xl">{template.name}</div>
                  <div className="mt-2 text-sm text-slate-300">{Math.round(template.totals.calories)} kcal / {template.items.length} items / {template.meal_type}</div>
                  {template.notes ? <div className="mt-2 text-sm text-slate-400">{template.notes}</div> : null}
                </div>
              ))}
              {!mealTemplatesQuery.data?.items?.length ? <EmptyState title="No meal templates yet" body="Save a staple meal here and it will become a one-tap log option on your phone." /> : null}
            </div>
          </Panel>

          <details className="rounded-[24px] border border-slate-200 bg-white/90 shadow-halo">
            <summary className="cursor-pointer list-none px-4 py-4">
              <div className="font-display text-xl text-slate-950">Build a meal template</div>
              <div className="mt-1 text-sm text-slate-500">Use saved foods or manual macro rows for the meals you repeat most.</div>
            </summary>
            <div className="border-t border-slate-200 px-4 py-4">
              <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); createMealTemplate.mutate() }}>
                <div className="grid gap-3 sm:grid-cols-2">
                  <LabelledInput label="Template name" value={mealTemplateDraft.name} onChange={(value) => setMealTemplateDraft((current) => ({ ...current, name: value }))} placeholder="Chicken rice bowl" />
                  <LabelledSelect
                    label="Meal type"
                    value={mealTemplateDraft.meal_type}
                    onChange={(value) => setMealTemplateDraft((current) => ({ ...current, meal_type: value }))}
                    options={[
                      { label: 'Breakfast', value: 'breakfast' },
                      { label: 'Lunch', value: 'lunch' },
                      { label: 'Dinner', value: 'dinner' },
                      { label: 'Snack', value: 'snack' },
                      { label: 'Meal', value: 'meal' },
                    ]}
                  />
                </div>
                <LabelledTextArea label="Notes" value={mealTemplateDraft.notes} onChange={(value) => setMealTemplateDraft((current) => ({ ...current, notes: value }))} rows={3} placeholder="Optional prep note or reminder" />

                {mealTemplateDraft.items.map((item, index) => (
                  <div key={index} className="rounded-[22px] bg-slate-50 p-4 ring-1 ring-slate-200">
                    <div className="grid gap-3">
                      <LabelledSelect
                        label="Saved food"
                        value={item.food_id}
                        onChange={(value) => {
                          const next = [...mealTemplateDraft.items]
                          const selectedFood = (foodsQuery.data?.items ?? []).find((food) => food.id === value)
                          next[index] = {
                            ...next[index],
                            food_id: value,
                            label: selectedFood?.name ?? next[index].label,
                          }
                          setMealTemplateDraft((current) => ({ ...current, items: next }))
                        }}
                        options={[
                          { label: 'Custom manual item', value: '' },
                          ...(foodsQuery.data?.items ?? []).map((food) => ({ label: food.name, value: food.id })),
                        ]}
                      />
                      <LabelledInput
                        label="Label"
                        value={item.label}
                        onChange={(value) => {
                          const next = [...mealTemplateDraft.items]
                          next[index] = { ...next[index], label: value }
                          setMealTemplateDraft((current) => ({ ...current, items: next }))
                        }}
                      />
                      <div className="grid grid-cols-2 gap-3">
                        <LabelledInput
                          label="Grams"
                          type="number"
                          value={item.grams}
                          onChange={(value) => {
                            const next = [...mealTemplateDraft.items]
                            next[index] = { ...next[index], grams: value }
                            setMealTemplateDraft((current) => ({ ...current, items: next }))
                          }}
                        />
                        <LabelledInput
                          label="Calories"
                          type="number"
                          value={item.calories}
                          onChange={(value) => {
                            const next = [...mealTemplateDraft.items]
                            next[index] = { ...next[index], calories: value }
                            setMealTemplateDraft((current) => ({ ...current, items: next }))
                          }}
                        />
                        <LabelledInput
                          label="Protein"
                          type="number"
                          value={item.protein_g}
                          onChange={(value) => {
                            const next = [...mealTemplateDraft.items]
                            next[index] = { ...next[index], protein_g: value }
                            setMealTemplateDraft((current) => ({ ...current, items: next }))
                          }}
                        />
                        <LabelledInput
                          label="Carbs"
                          type="number"
                          value={item.carbs_g}
                          onChange={(value) => {
                            const next = [...mealTemplateDraft.items]
                            next[index] = { ...next[index], carbs_g: value }
                            setMealTemplateDraft((current) => ({ ...current, items: next }))
                          }}
                        />
                      </div>
                      <LabelledInput
                        label="Fat"
                        type="number"
                        value={item.fat_g}
                        onChange={(value) => {
                          const next = [...mealTemplateDraft.items]
                          next[index] = { ...next[index], fat_g: value }
                          setMealTemplateDraft((current) => ({ ...current, items: next }))
                        }}
                      />
                    </div>
                  </div>
                ))}

                <div className="flex flex-col gap-2 sm:flex-row">
                  <ActionButton
                    tone="secondary"
                    onClick={() => setMealTemplateDraft((current) => ({
                      ...current,
                      items: [...current.items, { food_id: '', label: '', grams: '100', calories: '0', protein_g: '0', carbs_g: '0', fat_g: '0' }],
                    }))}
                    className="w-full sm:w-auto"
                  >
                    Add meal item
                  </ActionButton>
                  <ActionButton type="submit" className="w-full sm:w-auto">Save meal template</ActionButton>
                </div>
              </form>
            </div>
          </details>
        </div>

        <div className="space-y-4">
          <Panel title="Workout templates" subtitle="These become quick starts on the Training page.">
            <div className="space-y-3">
              {(workoutTemplatesQuery.data?.items ?? []).map((template) => (
                <div key={template.id} className="rounded-[24px] border border-slate-200 bg-white p-4">
                  <div className="font-display text-xl text-slate-950">{template.name}</div>
                  <div className="mt-2 text-sm text-slate-500">{template.items.length} lift slots</div>
                  {template.notes ? <div className="mt-2 text-sm text-slate-500">{template.notes}</div> : null}
                </div>
              ))}
              {!workoutTemplatesQuery.data?.items?.length ? <EmptyState title="No workout templates yet" body="Save your common split or repeat session structure here for one-tap reuse." /> : null}
            </div>
          </Panel>

          <details className="rounded-[24px] border border-slate-200 bg-white/90 shadow-halo">
            <summary className="cursor-pointer list-none px-4 py-4">
              <div className="font-display text-xl text-slate-950">Build a workout template</div>
              <div className="mt-1 text-sm text-slate-500">Create a repeatable session that can populate the training log in one tap.</div>
            </summary>
            <div className="border-t border-slate-200 px-4 py-4">
              <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); createWorkoutTemplate.mutate() }}>
                <LabelledInput label="Template name" value={workoutTemplateDraft.name} onChange={(value) => setWorkoutTemplateDraft((current) => ({ ...current, name: value }))} placeholder="Push day" />
                <LabelledTextArea label="Notes" value={workoutTemplateDraft.notes} onChange={(value) => setWorkoutTemplateDraft((current) => ({ ...current, notes: value }))} rows={3} placeholder="Optional session notes or cues" />

                {workoutTemplateDraft.items.map((item, index) => (
                  <div key={index} className="rounded-[22px] bg-slate-50 p-4 ring-1 ring-slate-200">
                    <div className="grid gap-3">
                      <LabelledSelect
                        label="Exercise"
                        value={item.exercise_id}
                        onChange={(value) => {
                          const next = [...workoutTemplateDraft.items]
                          next[index] = { ...next[index], exercise_id: value }
                          setWorkoutTemplateDraft((current) => ({ ...current, items: next }))
                        }}
                        options={[
                          { label: 'Select exercise', value: '' },
                          ...(exercisesQuery.data?.items ?? []).map((exercise) => ({ label: exercise.name, value: exercise.id })),
                        ]}
                      />
                      <div className="grid grid-cols-2 gap-3">
                        <LabelledInput
                          label="Sets"
                          type="number"
                          value={item.target_sets}
                          onChange={(value) => {
                            const next = [...workoutTemplateDraft.items]
                            next[index] = { ...next[index], target_sets: value }
                            setWorkoutTemplateDraft((current) => ({ ...current, items: next }))
                          }}
                        />
                        <LabelledInput
                          label="Rest (sec)"
                          type="number"
                          value={item.rest_seconds}
                          onChange={(value) => {
                            const next = [...workoutTemplateDraft.items]
                            next[index] = { ...next[index], rest_seconds: value }
                            setWorkoutTemplateDraft((current) => ({ ...current, items: next }))
                          }}
                        />
                        <LabelledInput
                          label="Rep min"
                          type="number"
                          value={item.target_reps_min}
                          onChange={(value) => {
                            const next = [...workoutTemplateDraft.items]
                            next[index] = { ...next[index], target_reps_min: value }
                            setWorkoutTemplateDraft((current) => ({ ...current, items: next }))
                          }}
                        />
                        <LabelledInput
                          label="Rep max"
                          type="number"
                          value={item.target_reps_max}
                          onChange={(value) => {
                            const next = [...workoutTemplateDraft.items]
                            next[index] = { ...next[index], target_reps_max: value }
                            setWorkoutTemplateDraft((current) => ({ ...current, items: next }))
                          }}
                        />
                      </div>
                    </div>
                  </div>
                ))}

                <div className="flex flex-col gap-2 sm:flex-row">
                  <ActionButton
                    tone="secondary"
                    onClick={() => setWorkoutTemplateDraft((current) => ({
                      ...current,
                      items: [...current.items, { exercise_id: '', target_sets: '3', target_reps_min: '8', target_reps_max: '12', rest_seconds: '120' }],
                    }))}
                    className="w-full sm:w-auto"
                  >
                    Add exercise slot
                  </ActionButton>
                  <ActionButton type="submit" className="w-full sm:w-auto">Save workout template</ActionButton>
                </div>
              </form>
            </div>
          </details>
        </div>
      </div>
    </div>
  )
}
