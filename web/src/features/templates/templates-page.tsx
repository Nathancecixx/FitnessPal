import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { ActionButton, ConfirmSheet, type ConfirmSheetRequest, EmptyState, LabelledInput, LabelledSelect, LabelledTextArea, PageIntro, Panel } from '../../components/ui'
import { api, type MealTemplate, type Routine, type WorkoutTemplate } from '../../lib/api'
import { queryClient } from '../../lib/query-client'

type MealTemplateItemDraft = {
  food_id: string
  label: string
  grams: string
  calories: string
  protein_g: string
  carbs_g: string
  fat_g: string
}

type MealTemplateDraft = {
  name: string
  meal_type: string
  notes: string
  items: MealTemplateItemDraft[]
}

type WorkoutTemplateItemDraft = {
  exercise_id: string
  target_sets: string
  target_reps_min: string
  target_reps_max: string
  rest_seconds: string
}

type WorkoutTemplateDraft = {
  name: string
  routine_id: string
  notes: string
  items: WorkoutTemplateItemDraft[]
}

function createEmptyMealTemplateItem(): MealTemplateItemDraft {
  return { food_id: '', label: '', grams: '180', calories: '0', protein_g: '0', carbs_g: '0', fat_g: '0' }
}

function createEmptyWorkoutTemplateItem(): WorkoutTemplateItemDraft {
  return { exercise_id: '', target_sets: '3', target_reps_min: '6', target_reps_max: '10', rest_seconds: '120' }
}

function createEmptyMealTemplateDraft(): MealTemplateDraft {
  return {
    name: '',
    meal_type: 'meal',
    notes: '',
    items: [createEmptyMealTemplateItem()],
  }
}

function createEmptyWorkoutTemplateDraft(): WorkoutTemplateDraft {
  return {
    name: '',
    routine_id: '',
    notes: '',
    items: [createEmptyWorkoutTemplateItem()],
  }
}

function toMealTemplateDraft(template: MealTemplate): MealTemplateDraft {
  return {
    name: template.name,
    meal_type: template.meal_type,
    notes: template.notes ?? '',
    items: template.items.length
      ? template.items.map((item) => ({
          food_id: item.food_id ?? '',
          label: item.label,
          grams: String(item.grams ?? ''),
          calories: String(item.calories ?? 0),
          protein_g: String(item.protein_g ?? 0),
          carbs_g: String(item.carbs_g ?? 0),
          fat_g: String(item.fat_g ?? 0),
        }))
      : [createEmptyMealTemplateItem()],
  }
}

function toWorkoutTemplateDraft(template: WorkoutTemplate): WorkoutTemplateDraft {
  return {
    name: template.name,
    routine_id: template.routine_id ?? '',
    notes: template.notes ?? '',
    items: template.items.length
      ? template.items.map((item) => ({
          exercise_id: item.exercise_id,
          target_sets: String(item.target_sets),
          target_reps_min: String(item.target_reps_min),
          target_reps_max: String(item.target_reps_max),
          rest_seconds: String(item.rest_seconds),
        }))
      : [createEmptyWorkoutTemplateItem()],
  }
}

function toMealTemplatePayload(draft: MealTemplateDraft) {
  return {
    name: draft.name,
    meal_type: draft.meal_type,
    notes: draft.notes,
    items: draft.items
      .filter((item) => item.food_id || item.label.trim())
      .map((item) => ({
        food_id: item.food_id || null,
        label: item.label,
        grams: item.grams ? Number(item.grams) : null,
        calories: item.food_id ? undefined : Number(item.calories),
        protein_g: item.food_id ? undefined : Number(item.protein_g),
        carbs_g: item.food_id ? undefined : Number(item.carbs_g),
        fat_g: item.food_id ? undefined : Number(item.fat_g),
        source_type: item.food_id ? 'food' : 'manual',
      })),
  }
}

function toWorkoutTemplatePayload(draft: WorkoutTemplateDraft) {
  return {
    name: draft.name,
    routine_id: draft.routine_id || null,
    notes: draft.notes,
    items: draft.items
      .filter((item) => item.exercise_id)
      .map((item, index) => ({
        exercise_id: item.exercise_id,
        order_index: index,
        target_sets: Number(item.target_sets),
        target_reps_min: Number(item.target_reps_min),
        target_reps_max: Number(item.target_reps_max),
        rest_seconds: Number(item.rest_seconds),
      })),
  }
}

function MealTemplateForm(props: {
  draft: MealTemplateDraft
  foods: Array<{ id: string; name: string }>
  submitLabel: string
  isSubmitting: boolean
  onChange: (draft: MealTemplateDraft) => void
  onSubmit: () => void
  onCancel?: () => void
}) {
  function updateDraft(next: Partial<MealTemplateDraft>) {
    props.onChange({ ...props.draft, ...next })
  }

  function updateItem(index: number, nextItem: MealTemplateItemDraft) {
    const items = [...props.draft.items]
    items[index] = nextItem
    updateDraft({ items })
  }

  function removeItem(index: number) {
    updateDraft({
      items: props.draft.items.length === 1 ? [createEmptyMealTemplateItem()] : props.draft.items.filter((_, itemIndex) => itemIndex !== index),
    })
  }

  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        props.onSubmit()
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <LabelledInput label="Template name" value={props.draft.name} onChange={(value) => updateDraft({ name: value })} placeholder="Chicken rice bowl" />
        <LabelledSelect
          label="Meal type"
          value={props.draft.meal_type}
          onChange={(value) => updateDraft({ meal_type: value })}
          options={[
            { label: 'Breakfast', value: 'breakfast' },
            { label: 'Lunch', value: 'lunch' },
            { label: 'Dinner', value: 'dinner' },
            { label: 'Snack', value: 'snack' },
            { label: 'Meal', value: 'meal' },
          ]}
        />
      </div>
      <LabelledTextArea label="Notes" value={props.draft.notes} onChange={(value) => updateDraft({ notes: value })} rows={3} placeholder="Optional prep note or reminder" />

      {props.draft.items.map((item, index) => (
        <div key={index} className="rounded-[22px] bg-slate-50 p-4 ring-1 ring-slate-200">
          <div className="grid gap-3">
            <LabelledSelect
              label="Saved food"
              value={item.food_id}
              onChange={(value) => {
                const selectedFood = props.foods.find((food) => food.id === value)
                updateItem(index, {
                  ...item,
                  food_id: value,
                  label: selectedFood?.name ?? item.label,
                })
              }}
              options={[
                { label: 'Custom manual item', value: '' },
                ...props.foods.map((food) => ({ label: food.name, value: food.id })),
              ]}
            />
            <LabelledInput label="Label" value={item.label} onChange={(value) => updateItem(index, { ...item, label: value })} />
            <div className="grid grid-cols-2 gap-3">
              <LabelledInput label="Grams" type="number" value={item.grams} onChange={(value) => updateItem(index, { ...item, grams: value })} />
              <LabelledInput label="Calories" type="number" value={item.calories} onChange={(value) => updateItem(index, { ...item, calories: value })} />
              <LabelledInput label="Protein" type="number" value={item.protein_g} onChange={(value) => updateItem(index, { ...item, protein_g: value })} />
              <LabelledInput label="Carbs" type="number" value={item.carbs_g} onChange={(value) => updateItem(index, { ...item, carbs_g: value })} />
            </div>
            <LabelledInput label="Fat" type="number" value={item.fat_g} onChange={(value) => updateItem(index, { ...item, fat_g: value })} />
            <div className="flex justify-end">
              <ActionButton tone="secondary" onClick={() => removeItem(index)} className="w-full sm:w-auto">
                Remove item
              </ActionButton>
            </div>
          </div>
        </div>
      ))}

      <div className="flex flex-col gap-2 sm:flex-row">
        <ActionButton
          tone="secondary"
          onClick={() => updateDraft({ items: [...props.draft.items, createEmptyMealTemplateItem()] })}
          className="w-full sm:w-auto"
        >
          Add meal item
        </ActionButton>
        <ActionButton type="submit" className="w-full sm:w-auto" disabled={props.isSubmitting}>
          {props.submitLabel}
        </ActionButton>
        {props.onCancel ? (
          <ActionButton tone="secondary" onClick={props.onCancel} className="w-full sm:w-auto">
            Cancel
          </ActionButton>
        ) : null}
      </div>
    </form>
  )
}

function WorkoutTemplateForm(props: {
  draft: WorkoutTemplateDraft
  exercises: Array<{ id: string; name: string }>
  routines: Routine[]
  submitLabel: string
  isSubmitting: boolean
  onChange: (draft: WorkoutTemplateDraft) => void
  onSubmit: () => void
  onCancel?: () => void
}) {
  function updateDraft(next: Partial<WorkoutTemplateDraft>) {
    props.onChange({ ...props.draft, ...next })
  }

  function updateItem(index: number, nextItem: WorkoutTemplateItemDraft) {
    const items = [...props.draft.items]
    items[index] = nextItem
    updateDraft({ items })
  }

  function removeItem(index: number) {
    updateDraft({
      items: props.draft.items.length === 1 ? [createEmptyWorkoutTemplateItem()] : props.draft.items.filter((_, itemIndex) => itemIndex !== index),
    })
  }

  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        props.onSubmit()
      }}
    >
      <LabelledInput label="Template name" value={props.draft.name} onChange={(value) => updateDraft({ name: value })} placeholder="Push day" />
      <LabelledSelect
        label="Attach to routine"
        value={props.draft.routine_id}
        onChange={(value) => updateDraft({ routine_id: value })}
        options={[
          { label: 'Standalone template', value: '' },
          ...props.routines.map((routine) => ({ label: routine.name, value: routine.id })),
        ]}
      />
      <LabelledTextArea label="Notes" value={props.draft.notes} onChange={(value) => updateDraft({ notes: value })} rows={3} placeholder="Optional session notes or cues" />

      {props.draft.items.map((item, index) => (
        <div key={index} className="rounded-[22px] bg-slate-50 p-4 ring-1 ring-slate-200">
          <div className="grid gap-3">
            <LabelledSelect
              label="Exercise"
              value={item.exercise_id}
              onChange={(value) => updateItem(index, { ...item, exercise_id: value })}
              options={[
                { label: 'Select exercise', value: '' },
                ...props.exercises.map((exercise) => ({ label: exercise.name, value: exercise.id })),
              ]}
            />
            <div className="grid grid-cols-2 gap-3">
              <LabelledInput label="Sets" type="number" value={item.target_sets} onChange={(value) => updateItem(index, { ...item, target_sets: value })} />
              <LabelledInput label="Rest (sec)" type="number" value={item.rest_seconds} onChange={(value) => updateItem(index, { ...item, rest_seconds: value })} />
              <LabelledInput label="Rep min" type="number" value={item.target_reps_min} onChange={(value) => updateItem(index, { ...item, target_reps_min: value })} />
              <LabelledInput label="Rep max" type="number" value={item.target_reps_max} onChange={(value) => updateItem(index, { ...item, target_reps_max: value })} />
            </div>
            <div className="flex justify-end">
              <ActionButton tone="secondary" onClick={() => removeItem(index)} className="w-full sm:w-auto">
                Remove exercise
              </ActionButton>
            </div>
          </div>
        </div>
      ))}

      <div className="flex flex-col gap-2 sm:flex-row">
        <ActionButton
          tone="secondary"
          onClick={() => updateDraft({ items: [...props.draft.items, createEmptyWorkoutTemplateItem()] })}
          className="w-full sm:w-auto"
        >
          Add exercise slot
        </ActionButton>
        <ActionButton type="submit" className="w-full sm:w-auto" disabled={props.isSubmitting}>
          {props.submitLabel}
        </ActionButton>
        {props.onCancel ? (
          <ActionButton tone="secondary" onClick={props.onCancel} className="w-full sm:w-auto">
            Cancel
          </ActionButton>
        ) : null}
      </div>
    </form>
  )
}

export function TemplatesPage() {
  const foodsQuery = useQuery({ queryKey: ['foods'], queryFn: () => api.listFoods() })
  const exercisesQuery = useQuery({ queryKey: ['exercises'], queryFn: api.listExercises })
  const routinesQuery = useQuery({ queryKey: ['routines'], queryFn: api.listRoutines })
  const mealTemplatesQuery = useQuery({ queryKey: ['meal-templates'], queryFn: api.listMealTemplates })
  const workoutTemplatesQuery = useQuery({ queryKey: ['workout-templates'], queryFn: api.listWorkoutTemplates })

  const [mealTemplateDraft, setMealTemplateDraft] = useState<MealTemplateDraft>(createEmptyMealTemplateDraft())
  const [workoutTemplateDraft, setWorkoutTemplateDraft] = useState<WorkoutTemplateDraft>(createEmptyWorkoutTemplateDraft())
  const [mealTemplateEditors, setMealTemplateEditors] = useState<Record<string, MealTemplateDraft>>({})
  const [workoutTemplateEditors, setWorkoutTemplateEditors] = useState<Record<string, WorkoutTemplateDraft>>({})
  const [editingMealTemplateId, setEditingMealTemplateId] = useState<string | null>(null)
  const [editingWorkoutTemplateId, setEditingWorkoutTemplateId] = useState<string | null>(null)
  const [confirmRequest, setConfirmRequest] = useState<ConfirmSheetRequest | null>(null)

  const createMealTemplate = useMutation({
    mutationFn: () => api.createMealTemplate(toMealTemplatePayload(mealTemplateDraft)),
    onSuccess: async () => {
      setMealTemplateDraft(createEmptyMealTemplateDraft())
      await queryClient.invalidateQueries({ queryKey: ['meal-templates'] })
    },
  })

  const updateMealTemplate = useMutation({
    mutationFn: ({ templateId, payload }: { templateId: string; payload: Record<string, unknown> }) => api.updateMealTemplate(templateId, payload),
    onSuccess: async (_, variables) => {
      setEditingMealTemplateId(null)
      setMealTemplateEditors((state) => {
        const next = { ...state }
        delete next[variables.templateId]
        return next
      })
      await queryClient.invalidateQueries({ queryKey: ['meal-templates'] })
    },
  })

  const deleteMealTemplate = useMutation({
    mutationFn: (templateId: string) => api.deleteMealTemplate(templateId),
    onSuccess: async (_, templateId) => {
      if (editingMealTemplateId === templateId) {
        setEditingMealTemplateId(null)
      }
      setMealTemplateEditors((state) => {
        const next = { ...state }
        delete next[templateId]
        return next
      })
      await queryClient.invalidateQueries({ queryKey: ['meal-templates'] })
    },
  })

  const createWorkoutTemplate = useMutation({
    mutationFn: () => api.createWorkoutTemplate(toWorkoutTemplatePayload(workoutTemplateDraft)),
    onSuccess: async () => {
      setWorkoutTemplateDraft(createEmptyWorkoutTemplateDraft())
      await queryClient.invalidateQueries({ queryKey: ['workout-templates'] })
    },
  })

  const updateWorkoutTemplate = useMutation({
    mutationFn: ({ templateId, payload }: { templateId: string; payload: Record<string, unknown> }) => api.updateWorkoutTemplate(templateId, payload),
    onSuccess: async (_, variables) => {
      setEditingWorkoutTemplateId(null)
      setWorkoutTemplateEditors((state) => {
        const next = { ...state }
        delete next[variables.templateId]
        return next
      })
      await queryClient.invalidateQueries({ queryKey: ['workout-templates'] })
    },
  })

  const deleteWorkoutTemplate = useMutation({
    mutationFn: (templateId: string) => api.deleteWorkoutTemplate(templateId),
    onSuccess: async (_, templateId) => {
      if (editingWorkoutTemplateId === templateId) {
        setEditingWorkoutTemplateId(null)
      }
      setWorkoutTemplateEditors((state) => {
        const next = { ...state }
        delete next[templateId]
        return next
      })
      await queryClient.invalidateQueries({ queryKey: ['workout-templates'] })
    },
  })

  const foods = foodsQuery.data?.items ?? []
  const exercises = exercisesQuery.data?.items ?? []
  const routines = routinesQuery.data?.items ?? []
  const routineNameById = Object.fromEntries(routines.map((routine) => [routine.id, routine.name]))

  function startEditingMealTemplate(template: MealTemplate) {
    setMealTemplateEditors((state) => ({ ...state, [template.id]: toMealTemplateDraft(template) }))
    setEditingMealTemplateId(template.id)
  }

  function startEditingWorkoutTemplate(template: WorkoutTemplate) {
    setWorkoutTemplateEditors((state) => ({ ...state, [template.id]: toWorkoutTemplateDraft(template) }))
    setEditingWorkoutTemplateId(template.id)
  }

  return (
    <div className="space-y-4">
      <PageIntro
        eyebrow="Templates"
        title="Save the repeatable stuff once"
        description="Save repeat meals and workouts for quick reuse."
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="space-y-4">
          <Panel title="Meal templates" subtitle="Ready for quick logging.">
            <div className="space-y-3">
              {(mealTemplatesQuery.data?.items ?? []).map((template) => {
                const editor = mealTemplateEditors[template.id] ?? toMealTemplateDraft(template)
                const isEditing = editingMealTemplateId === template.id
                return (
                  <div key={template.id} className="rounded-[24px] bg-slate-950 px-4 py-4 text-canvas">
                    <div className="font-display text-xl">{template.name}</div>
                    <div className="mt-2 text-sm text-slate-300">{Math.round(template.totals.calories)} kcal / {template.items.length} items / {template.meal_type}</div>
                    {template.notes ? <div className="mt-2 text-sm text-slate-400">{template.notes}</div> : null}
                    <div className="mt-4 flex flex-wrap gap-2">
                      <ActionButton tone="secondary" onClick={() => startEditingMealTemplate(template)} className="w-auto">
                        Edit
                      </ActionButton>
                      <ActionButton
                        tone="secondary"
                        onClick={() => setConfirmRequest({
                          title: 'Delete this meal template?',
                          body: `Type ${template.name} to confirm deleting this meal template.`,
                          confirmLabel: 'Delete template',
                          confirmationValue: template.name,
                          confirmationHint: `Type ${template.name} to confirm`,
                          isPending: deleteMealTemplate.isPending,
                          onConfirm: () => deleteMealTemplate.mutate(template.id),
                        })}
                        className="w-auto"
                        disabled={deleteMealTemplate.isPending}
                      >
                        Delete
                      </ActionButton>
                    </div>
                    {isEditing ? (
                      <div className="mt-4 rounded-[20px] bg-white/10 p-4">
                        <MealTemplateForm
                          draft={editor}
                          foods={foods}
                          submitLabel="Save changes"
                          isSubmitting={updateMealTemplate.isPending}
                          onChange={(draft) => setMealTemplateEditors((state) => ({ ...state, [template.id]: draft }))}
                          onSubmit={() => updateMealTemplate.mutate({ templateId: template.id, payload: toMealTemplatePayload(editor) })}
                          onCancel={() => setEditingMealTemplateId(null)}
                        />
                      </div>
                    ) : null}
                  </div>
                )
              })}
              {!mealTemplatesQuery.data?.items?.length ? <EmptyState title="No meal templates yet" body="Saved meal templates will show up here." /> : null}
            </div>
          </Panel>

          <details className="rounded-[24px] border border-slate-200 bg-white/90 shadow-halo">
            <summary className="cursor-pointer list-none px-4 py-4">
              <div className="font-display text-xl text-slate-950">Build a meal template</div>
              <div className="mt-1 text-sm text-slate-500">Save a repeat meal.</div>
            </summary>
            <div className="border-t border-slate-200 px-4 py-4">
              <MealTemplateForm
                draft={mealTemplateDraft}
                foods={foods}
                submitLabel="Save meal template"
                isSubmitting={createMealTemplate.isPending}
                onChange={setMealTemplateDraft}
                onSubmit={() => createMealTemplate.mutate()}
              />
            </div>
          </details>
        </div>

        <div className="space-y-4">
          <Panel title="Workout templates" subtitle="Ready for quick starts.">
            <div className="space-y-3">
              {(workoutTemplatesQuery.data?.items ?? []).map((template) => {
                const editor = workoutTemplateEditors[template.id] ?? toWorkoutTemplateDraft(template)
                const isEditing = editingWorkoutTemplateId === template.id
                return (
                  <div key={template.id} className="rounded-[24px] border border-slate-200 bg-white p-4">
                    <div className="font-display text-xl text-slate-950">{template.name}</div>
                    <div className="mt-2 text-sm text-slate-500">
                      {template.items.length} lift slots{template.routine_id ? ` / ${routineNameById[template.routine_id] ?? 'Routine linked'}` : ''}
                    </div>
                    {template.notes ? <div className="mt-2 text-sm text-slate-500">{template.notes}</div> : null}
                    <div className="mt-4 flex flex-wrap gap-2">
                      <ActionButton tone="secondary" onClick={() => startEditingWorkoutTemplate(template)} className="w-auto">
                        Edit
                      </ActionButton>
                      <ActionButton
                        tone="secondary"
                        onClick={() => setConfirmRequest({
                          title: 'Delete this workout template?',
                          body: `Type ${template.name} to confirm deleting this workout template.`,
                          confirmLabel: 'Delete template',
                          confirmationValue: template.name,
                          confirmationHint: `Type ${template.name} to confirm`,
                          isPending: deleteWorkoutTemplate.isPending,
                          onConfirm: () => deleteWorkoutTemplate.mutate(template.id),
                        })}
                        className="w-auto"
                        disabled={deleteWorkoutTemplate.isPending}
                      >
                        Delete
                      </ActionButton>
                    </div>
                    {isEditing ? (
                      <div className="mt-4 rounded-[20px] bg-slate-50 p-4">
                        <WorkoutTemplateForm
                          draft={editor}
                          exercises={exercises}
                          routines={routines}
                          submitLabel="Save changes"
                          isSubmitting={updateWorkoutTemplate.isPending}
                          onChange={(draft) => setWorkoutTemplateEditors((state) => ({ ...state, [template.id]: draft }))}
                          onSubmit={() => updateWorkoutTemplate.mutate({ templateId: template.id, payload: toWorkoutTemplatePayload(editor) })}
                          onCancel={() => setEditingWorkoutTemplateId(null)}
                        />
                      </div>
                    ) : null}
                  </div>
                )
              })}
              {!workoutTemplatesQuery.data?.items?.length ? <EmptyState title="No workout templates yet" body="Saved workout templates will show up here." /> : null}
            </div>
          </Panel>

          <details className="rounded-[24px] border border-slate-200 bg-white/90 shadow-halo">
            <summary className="cursor-pointer list-none px-4 py-4">
              <div className="font-display text-xl text-slate-950">Build a workout template</div>
              <div className="mt-1 text-sm text-slate-500">Save a repeat workout.</div>
            </summary>
            <div className="border-t border-slate-200 px-4 py-4">
              <WorkoutTemplateForm
                draft={workoutTemplateDraft}
                exercises={exercises}
                routines={routines}
                submitLabel="Save workout template"
                isSubmitting={createWorkoutTemplate.isPending}
                onChange={setWorkoutTemplateDraft}
                onSubmit={() => createWorkoutTemplate.mutate()}
              />
            </div>
          </details>
        </div>
      </div>

      <ConfirmSheet request={confirmRequest} onClose={() => setConfirmRequest(null)} />
    </div>
  )
}
