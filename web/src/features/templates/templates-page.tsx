import { useQuery } from '@tanstack/react-query'

import { ActionButton, EmptyState, LabelledInput, PageIntro, Panel } from '../../components/ui'
import { api } from '../../lib/api'

export function TemplatesPage() {
  const foodsQuery = useQuery({ queryKey: ['foods'], queryFn: () => api.listFoods() })
  const exercisesQuery = useQuery({ queryKey: ['exercises'], queryFn: api.listExercises })
  const mealTemplatesQuery = useQuery({ queryKey: ['meal-templates'], queryFn: api.listMealTemplates })
  const workoutTemplatesQuery = useQuery({ queryKey: ['workout-templates'], queryFn: api.listWorkoutTemplates })

  return (
    <div className="space-y-4">
      <PageIntro
        eyebrow="Templates"
        title="Save the meals and sessions you repeat constantly"
        description="Templates keep local logging friction low. Build recurring meal presets for staple foods and repeatable workout skeletons for your split, then let the agent or UI expand them into actual logs."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Meal templates" subtitle="Ready for staple meals like chicken-rice bowls or oats shakes.">
          <div className="rounded-[24px] bg-amber-50 px-4 py-4 text-sm text-amber-900">
            The backend supports multi-item meal templates today. This page surfaces the saved ones and can grow into a richer builder without changing the API contract.
          </div>
          <div className="mt-4 grid gap-3">
            {(mealTemplatesQuery.data?.items ?? []).map((template) => (
              <div key={template.id} className="rounded-[24px] bg-slate-950 px-4 py-4 text-canvas">
                <div className="font-display text-xl">{template.name}</div>
                <div className="mt-2 text-sm text-slate-300">{Math.round(template.totals.calories)} kcal • {template.items.length} items</div>
              </div>
            ))}
            {!mealTemplatesQuery.data?.items?.length ? <EmptyState title="No meal templates yet" body={`Start with reusable foods. Saved foods available: ${(foodsQuery.data?.items ?? []).length}.`} /> : null}
          </div>
        </Panel>

        <Panel title="Workout templates" subtitle="Reusable push, pull, legs, or block-specific sessions.">
          <div className="rounded-[24px] bg-sky-50 px-4 py-4 text-sm text-sky-900">
            Workout templates are backed by the `/workout-templates` API and remain small, explicit JSON structures that OpenClaw can expand into sessions or edit safely.
          </div>
          <div className="mt-4 grid gap-3">
            {(workoutTemplatesQuery.data?.items ?? []).map((template) => (
              <div key={template.id} className="rounded-[24px] border border-slate-200 bg-white px-4 py-4 text-sm">
                <div className="font-display text-xl text-slate-950">{template.name}</div>
                <div className="mt-2 text-slate-500">{template.items.length} exercise slots</div>
              </div>
            ))}
            {!workoutTemplatesQuery.data?.items?.length ? <EmptyState title="No workout templates yet" body={`Exercises available for template building: ${(exercisesQuery.data?.items ?? []).length}.`} /> : null}
          </div>
          <div className="mt-4 rounded-[24px] border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
            Full visual builders can be added next without changing any backend routes because meal and workout templates already use dedicated REST resources.
          </div>
        </Panel>
      </div>
    </div>
  )
}

