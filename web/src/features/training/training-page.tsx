import { useMutation, useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { ActionButton, EmptyState, LabelledInput, PageIntro, Panel } from '../../components/ui'
import { api } from '../../lib/api'
import { queryClient } from '../../lib/query-client'

export function TrainingPage() {
  const exercisesQuery = useQuery({ queryKey: ['exercises'], queryFn: api.listExercises })
  const sessionsQuery = useQuery({ queryKey: ['workout-sessions'], queryFn: api.listWorkoutSessions })
  const templatesQuery = useQuery({ queryKey: ['workout-templates'], queryFn: api.listWorkoutTemplates })
  const [selectedExerciseId, setSelectedExerciseId] = useState('')
  const [exerciseDraft, setExerciseDraft] = useState({ name: '', rep_target_min: '6', rep_target_max: '10', load_increment: '2.5' })
  const [sessionDraft, setSessionDraft] = useState({ notes: 'Push day', sets: [{ exercise_id: '', set_index: '1', reps: '8', load_kg: '60', rir: '2' }] })

  const progressionQuery = useQuery({
    queryKey: ['exercise-progression', selectedExerciseId],
    queryFn: () => api.getExerciseProgression(selectedExerciseId),
    enabled: Boolean(selectedExerciseId),
  })

  const createExercise = useMutation({
    mutationFn: () => api.createExercise({
      name: exerciseDraft.name,
      rep_target_min: Number(exerciseDraft.rep_target_min),
      rep_target_max: Number(exerciseDraft.rep_target_max),
      load_increment: Number(exerciseDraft.load_increment),
    }),
    onSuccess: async () => {
      setExerciseDraft({ name: '', rep_target_min: '6', rep_target_max: '10', load_increment: '2.5' })
      await queryClient.invalidateQueries({ queryKey: ['exercises'] })
    },
  })

  const createSession = useMutation({
    mutationFn: () => api.createWorkoutSession({
      notes: sessionDraft.notes,
      sets: sessionDraft.sets
        .filter((item) => item.exercise_id)
        .map((item) => ({
          exercise_id: item.exercise_id,
          set_index: Number(item.set_index),
          reps: Number(item.reps),
          load_kg: Number(item.load_kg),
          rir: Number(item.rir),
        })),
    }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['workout-sessions'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['insights'] }),
      ])
    },
  })

  const recentSessions = useMemo(() => (sessionsQuery.data?.items ?? []).slice(0, 4), [sessionsQuery.data?.items])

  return (
    <div className="space-y-4">
      <PageIntro
        eyebrow="Training"
        title="Progressive overload without spreadsheet fatigue"
        description="Track every set, keep templates ready for repeat sessions, and watch recovery-aware progression recommendations update against your weight and calorie context."
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_380px]">
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Exercise library" subtitle="Store progression defaults once, then let the app coach the next jumps.">
              <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); createExercise.mutate() }}>
                <LabelledInput label="Exercise name" value={exerciseDraft.name} onChange={(value) => setExerciseDraft((current) => ({ ...current, name: value }))} />
                <div className="grid gap-3 sm:grid-cols-3">
                  <LabelledInput label="Rep min" type="number" value={exerciseDraft.rep_target_min} onChange={(value) => setExerciseDraft((current) => ({ ...current, rep_target_min: value }))} />
                  <LabelledInput label="Rep max" type="number" value={exerciseDraft.rep_target_max} onChange={(value) => setExerciseDraft((current) => ({ ...current, rep_target_max: value }))} />
                  <LabelledInput label="Load jump" type="number" step="0.5" value={exerciseDraft.load_increment} onChange={(value) => setExerciseDraft((current) => ({ ...current, load_increment: value }))} />
                </div>
                <ActionButton type="submit">Save exercise</ActionButton>
              </form>
              <div className="mt-4 grid gap-2">
                {(exercisesQuery.data?.items ?? []).slice(0, 8).map((exercise) => (
                  <button key={exercise.id} className="rounded-2xl bg-slate-100 px-4 py-3 text-left text-sm" onClick={() => setSelectedExerciseId(exercise.id)}>
                    <div className="font-semibold text-slate-950">{exercise.name}</div>
                    <div className="mt-1 text-slate-500">{exercise.rep_target_min}-{exercise.rep_target_max} reps, +{exercise.load_increment} kg</div>
                  </button>
                ))}
              </div>
            </Panel>

            <Panel title="Log workout session" subtitle="Add one or more working sets, keep it fast, and let the backend compute volume and PRs.">
              <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); createSession.mutate() }}>
                <LabelledInput label="Session notes" value={sessionDraft.notes} onChange={(value) => setSessionDraft((current) => ({ ...current, notes: value }))} />
                {sessionDraft.sets.map((item, index) => (
                  <div key={index} className="grid gap-3 rounded-[24px] bg-slate-100 p-4 sm:grid-cols-2">
                    <label className="sm:col-span-2 block">
                      <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Exercise</span>
                      <select className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm" value={item.exercise_id} onChange={(event) => {
                        const next = [...sessionDraft.sets]
                        next[index] = { ...next[index], exercise_id: event.target.value }
                        setSessionDraft((current) => ({ ...current, sets: next }))
                      }}>
                        <option value="">Select exercise</option>
                        {(exercisesQuery.data?.items ?? []).map((exercise) => <option key={exercise.id} value={exercise.id}>{exercise.name}</option>)}
                      </select>
                    </label>
                    <LabelledInput label="Set #" type="number" value={item.set_index} onChange={(value) => {
                      const next = [...sessionDraft.sets]
                      next[index] = { ...next[index], set_index: value }
                      setSessionDraft((current) => ({ ...current, sets: next }))
                    }} />
                    <LabelledInput label="Reps" type="number" value={item.reps} onChange={(value) => {
                      const next = [...sessionDraft.sets]
                      next[index] = { ...next[index], reps: value }
                      setSessionDraft((current) => ({ ...current, sets: next }))
                    }} />
                    <LabelledInput label="Load kg" type="number" value={item.load_kg} onChange={(value) => {
                      const next = [...sessionDraft.sets]
                      next[index] = { ...next[index], load_kg: value }
                      setSessionDraft((current) => ({ ...current, sets: next }))
                    }} />
                    <LabelledInput label="RIR" type="number" value={item.rir} onChange={(value) => {
                      const next = [...sessionDraft.sets]
                      next[index] = { ...next[index], rir: value }
                      setSessionDraft((current) => ({ ...current, sets: next }))
                    }} />
                  </div>
                ))}
                <div className="flex flex-wrap gap-3">
                  <ActionButton tone="secondary" onClick={() => setSessionDraft((current) => ({ ...current, sets: [...current.sets, { exercise_id: '', set_index: String(current.sets.length + 1), reps: '8', load_kg: '60', rir: '2' }] }))}>Add another set</ActionButton>
                  <ActionButton type="submit">Log session</ActionButton>
                </div>
              </form>
            </Panel>
          </div>

          <Panel title="Recent sessions" subtitle="Volume, total sets, and notes from the latest logs.">
            <div className="grid gap-3">
              {recentSessions.map((session) => (
                <div key={session.id} className="rounded-[24px] bg-slate-950 px-4 py-4 text-canvas">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-display text-xl">{session.notes || 'Workout session'}</div>
                      <div className="text-xs uppercase tracking-[0.2em] text-slate-400">{new Date(session.started_at).toLocaleString()}</div>
                    </div>
                    <div className="rounded-full bg-white/10 px-3 py-2 text-sm">{Math.round(session.total_volume_kg)} kg volume</div>
                  </div>
                  <div className="mt-3 text-sm text-slate-300">{session.total_sets} working sets logged</div>
                </div>
              ))}
              {!recentSessions.length ? <EmptyState title="No workouts yet" body="Create an exercise, log your first session, and the progression tab will start making overload suggestions." /> : null}
            </div>
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="Progression recommendation" subtitle="Recovery-aware next step based on the recent history for a selected lift.">
            {progressionQuery.data?.recommendation ? (
              <div className="rounded-[28px] bg-lime p-5 text-slate-950">
                <div className="text-xs uppercase tracking-[0.25em] text-slate-700">Next action</div>
                <div className="mt-2 font-display text-3xl">{progressionQuery.data.recommendation.recommendation}</div>
                <div className="mt-3 text-sm">Target next load: {progressionQuery.data.recommendation.next_load_kg} kg</div>
                <p className="mt-3 text-sm leading-6">{progressionQuery.data.recommendation.reason}</p>
              </div>
            ) : (
              <EmptyState title="Pick an exercise" body="Choose a lift from the library to inspect its current overload recommendation." />
            )}
          </Panel>

          <Panel title="Saved workout templates" subtitle="Reusable sessions for repeat push, pull, leg, or block work.">
            <div className="space-y-3">
              {(templatesQuery.data?.items ?? []).slice(0, 5).map((template) => (
                <div key={template.id} className="rounded-[24px] border border-slate-200 bg-white px-4 py-4 text-sm">
                  <div className="font-semibold text-slate-950">{template.name}</div>
                  <div className="mt-1 text-slate-500">{template.items.length} planned exercise slots</div>
                </div>
              ))}
              {!templatesQuery.data?.items?.length ? <EmptyState title="No workout templates yet" body="Jump into the Templates tab to build repeatable sessions for your main split." /> : null}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  )
}
