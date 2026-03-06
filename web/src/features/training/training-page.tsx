import { useMutation, useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { ActionButton, EmptyState, LabelledInput, LabelledSelect, PageIntro, Panel } from '../../components/ui'
import { api, type WorkoutSession, type WorkoutTemplate } from '../../lib/api'
import { queryClient } from '../../lib/query-client'

type SessionBlockDraft = {
  exercise_id: string
  target_sets: string
  reps: string
  load_kg: string
  rir: string
}

type ExerciseDraft = {
  name: string
  rep_target_min: string
  rep_target_max: string
  load_increment: string
}

function createSessionBlockDraft(exerciseId = ''): SessionBlockDraft {
  return {
    exercise_id: exerciseId,
    target_sets: '3',
    reps: '8',
    load_kg: '0',
    rir: '2',
  }
}

function buildBlocksFromTemplate(template: WorkoutTemplate): SessionBlockDraft[] {
  return template.items.map((item) => ({
    exercise_id: item.exercise_id,
    target_sets: String(item.target_sets),
    reps: String(item.target_reps_max),
    load_kg: '0',
    rir: item.target_rir != null ? String(item.target_rir) : '2',
  }))
}

function buildBlocksFromSession(session: WorkoutSession): SessionBlockDraft[] {
  const grouped = new Map<string, SessionBlockDraft>()
  const order: string[] = []

  for (const entry of session.sets) {
    if (!grouped.has(entry.exercise_id)) {
      grouped.set(entry.exercise_id, {
        exercise_id: entry.exercise_id,
        target_sets: '0',
        reps: String(entry.reps),
        load_kg: String(entry.load_kg),
        rir: String(entry.rir ?? 2),
      })
      order.push(entry.exercise_id)
    }

    const current = grouped.get(entry.exercise_id)
    if (!current) continue
    current.target_sets = String(Number(current.target_sets) + 1)
    current.reps = String(entry.reps)
    current.load_kg = String(entry.load_kg)
    current.rir = String(entry.rir ?? 2)
  }

  return order.map((exerciseId) => grouped.get(exerciseId) ?? createSessionBlockDraft(exerciseId))
}

function expandBlocksToSets(blocks: SessionBlockDraft[]) {
  let setIndex = 1

  return blocks.flatMap((block) => {
    const plannedSets = Number(block.target_sets) || 0
    if (!block.exercise_id || plannedSets <= 0) {
      return []
    }

    return Array.from({ length: plannedSets }, () => ({
      exercise_id: block.exercise_id,
      set_index: setIndex++,
      reps: Number(block.reps) || 0,
      load_kg: Number(block.load_kg) || 0,
      rir: block.rir ? Number(block.rir) : null,
    }))
  })
}

function summarizeSession(session: WorkoutSession, exerciseNameById: Record<string, string>) {
  const summary = new Map<string, number>()

  for (const entry of session.sets) {
    const label = exerciseNameById[entry.exercise_id] ?? 'Exercise'
    summary.set(label, (summary.get(label) ?? 0) + 1)
  }

  return Array.from(summary.entries())
    .slice(0, 3)
    .map(([label, count]) => `${count}x ${label}`)
    .join(' / ')
}

export function TrainingPage() {
  const exercisesQuery = useQuery({ queryKey: ['exercises'], queryFn: api.listExercises })
  const sessionsQuery = useQuery({ queryKey: ['workout-sessions'], queryFn: api.listWorkoutSessions })
  const templatesQuery = useQuery({ queryKey: ['workout-templates'], queryFn: api.listWorkoutTemplates })
  const [selectedExerciseId, setSelectedExerciseId] = useState('')
  const [exerciseDraft, setExerciseDraft] = useState<ExerciseDraft>({
    name: '',
    rep_target_min: '6',
    rep_target_max: '10',
    load_increment: '2.5',
  })
  const [sessionDraft, setSessionDraft] = useState({
    notes: '',
    perceived_energy: '',
    bodyweight_kg: '',
    blocks: [createSessionBlockDraft()],
  })
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)

  const exercises = exercisesQuery.data?.items ?? []
  const sessions = sessionsQuery.data?.items ?? []
  const templates = templatesQuery.data?.items ?? []

  const exerciseNameById = useMemo(
    () => Object.fromEntries(exercises.map((exercise) => [exercise.id, exercise.name])),
    [exercises],
  )

  const draftExerciseIds = useMemo(
    () => Array.from(new Set(sessionDraft.blocks.map((block) => block.exercise_id).filter(Boolean))),
    [sessionDraft.blocks],
  )

  const quickExercises = useMemo(() => exercises.slice(0, 8), [exercises])
  const recentSessions = useMemo(() => sessions.slice(0, 4), [sessions])
  const quickTemplates = useMemo(() => templates.slice(0, 4), [templates])

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

  const saveSession = useMutation({
    mutationFn: () => (editingSessionId ? api.updateWorkoutSession(editingSessionId, {
      notes: sessionDraft.notes || undefined,
      perceived_energy: sessionDraft.perceived_energy ? Number(sessionDraft.perceived_energy) : undefined,
      bodyweight_kg: sessionDraft.bodyweight_kg ? Number(sessionDraft.bodyweight_kg) : undefined,
      sets: expandBlocksToSets(sessionDraft.blocks),
    }) : api.createWorkoutSession({
      notes: sessionDraft.notes || undefined,
      perceived_energy: sessionDraft.perceived_energy ? Number(sessionDraft.perceived_energy) : undefined,
      bodyweight_kg: sessionDraft.bodyweight_kg ? Number(sessionDraft.bodyweight_kg) : undefined,
      sets: expandBlocksToSets(sessionDraft.blocks),
    })),
    onSuccess: async () => {
      setSessionDraft({
        notes: '',
        perceived_energy: '',
        bodyweight_kg: '',
        blocks: [createSessionBlockDraft()],
      })
      setEditingSessionId(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['workout-sessions'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['insights'] }),
        queryClient.invalidateQueries({ queryKey: ['exercise-progression'] }),
      ])
    },
  })

  const deleteSession = useMutation({
    mutationFn: (sessionId: string) => api.deleteWorkoutSession(sessionId),
    onSuccess: async (_, sessionId) => {
      if (editingSessionId === sessionId) {
        setEditingSessionId(null)
        setSessionDraft({
          notes: '',
          perceived_energy: '',
          bodyweight_kg: '',
          blocks: [createSessionBlockDraft()],
        })
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['workout-sessions'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['insights'] }),
      ])
    },
  })

  function updateBlock(index: number, key: keyof SessionBlockDraft, value: string) {
    setSessionDraft((current) => {
      const next = [...current.blocks]
      next[index] = { ...next[index], [key]: value }
      return { ...current, blocks: next }
    })

    if (key === 'exercise_id' && value) {
      setSelectedExerciseId(value)
    }
  }

  function addBlock(prefill?: Partial<SessionBlockDraft>) {
    setSessionDraft((current) => ({
      ...current,
      blocks: [...current.blocks, { ...createSessionBlockDraft(), ...prefill }],
    }))
  }

  function removeBlock(index: number) {
    setSessionDraft((current) => ({
      ...current,
      blocks: current.blocks.length === 1
        ? [createSessionBlockDraft()]
        : current.blocks.filter((_, blockIndex) => blockIndex !== index),
    }))
  }

  function applyTemplate(template: WorkoutTemplate) {
    const blocks = buildBlocksFromTemplate(template)
    setEditingSessionId(null)
    setSessionDraft((current) => ({
      ...current,
      notes: template.name,
      blocks: blocks.length ? blocks : [createSessionBlockDraft()],
    }))

    if (blocks[0]?.exercise_id) {
      setSelectedExerciseId(blocks[0].exercise_id)
    }
  }

  function repeatSession(session: WorkoutSession) {
    const blocks = buildBlocksFromSession(session)
    setEditingSessionId(null)
    setSessionDraft((current) => ({
      ...current,
      notes: session.notes ?? 'Repeat session',
      perceived_energy: session.perceived_energy != null ? String(session.perceived_energy) : current.perceived_energy,
      bodyweight_kg: session.bodyweight_kg != null ? String(session.bodyweight_kg) : current.bodyweight_kg,
      blocks: blocks.length ? blocks : [createSessionBlockDraft()],
    }))

    if (blocks[0]?.exercise_id) {
      setSelectedExerciseId(blocks[0].exercise_id)
    }
  }

  const progressionRecommendation = progressionQuery.data?.recommendation
  const selectedExercise = exercises.find((exercise) => exercise.id === selectedExerciseId)

  return (
    <div className="space-y-4">
      <PageIntro
        eyebrow="Training"
        title="Log the workout while it is happening"
        description="Start from a template, repeat the last session, or tap in a few lifts manually. The screen stays light for phone use, while progression defaults and extra detail stay close by when you need them."
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <div className="space-y-4">
          <Panel title={"Start today's workout"} subtitle="Use the fastest path first, then fine-tune only what matters.">
            <div className="space-y-4">
              <div className="space-y-3">
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Quick starts</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {quickTemplates.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4 text-left transition hover:border-amber-300 hover:bg-amber-50"
                      onClick={() => applyTemplate(template)}
                    >
                      <div className="font-semibold text-slate-950">{template.name}</div>
                      <div className="mt-1 text-sm text-slate-500">{template.items.length} lift slots</div>
                    </button>
                  ))}
                  {recentSessions.slice(0, 2).map((session) => (
                    <button
                      key={session.id}
                      type="button"
                      className="rounded-[22px] border border-slate-200 bg-white px-4 py-4 text-left transition hover:border-sky-300 hover:bg-sky-50"
                      onClick={() => repeatSession(session)}
                    >
                      <div className="font-semibold text-slate-950">{session.notes || 'Repeat last session'}</div>
                      <div className="mt-1 text-sm text-slate-500">{summarizeSession(session, exerciseNameById) || `${session.total_sets} sets`}</div>
                    </button>
                  ))}
                </div>
                {!quickTemplates.length && !recentSessions.length ? (
                  <EmptyState title="No quick starts yet" body="Create a few exercises, save a template, or log one session and this page becomes much faster to use." />
                ) : null}
              </div>

              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault()
                  saveSession.mutate()
                }}
              >
                <LabelledInput
                  label={editingSessionId ? 'Session label or notes (editing)' : 'Session label or notes'}
                  value={sessionDraft.notes}
                  onChange={(value) => setSessionDraft((current) => ({ ...current, notes: value }))}
                  placeholder="Push day, hotel gym, short upper session"
                />

                <div className="space-y-3">
                  {sessionDraft.blocks.map((block, index) => {
                    const exercise = exercises.find((item) => item.id === block.exercise_id)
                    return (
                      <div key={`${block.exercise_id || 'new'}-${index}`} className="rounded-[24px] bg-slate-50 p-4 ring-1 ring-slate-200">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <div>
                            <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Lift {index + 1}</div>
                            <div className="mt-1 font-semibold text-slate-950">{exercise?.name ?? 'Pick an exercise'}</div>
                          </div>
                          <button
                            type="button"
                            className="rounded-full bg-white px-3 py-2 text-sm font-semibold text-slate-600 ring-1 ring-slate-200"
                            onClick={() => removeBlock(index)}
                          >
                            Remove
                          </button>
                        </div>

                        <div className="grid gap-3">
                          <LabelledSelect
                            label="Exercise"
                            value={block.exercise_id}
                            onChange={(value) => updateBlock(index, 'exercise_id', value)}
                            options={[
                              { label: 'Select exercise', value: '' },
                              ...exercises.map((exerciseItem) => ({ label: exerciseItem.name, value: exerciseItem.id })),
                            ]}
                          />
                          <div className="grid grid-cols-2 gap-3">
                            <LabelledInput label="Sets" type="number" value={block.target_sets} onChange={(value) => updateBlock(index, 'target_sets', value)} />
                            <LabelledInput label="Reps" type="number" value={block.reps} onChange={(value) => updateBlock(index, 'reps', value)} />
                            <LabelledInput label="Load kg" type="number" value={block.load_kg} onChange={(value) => updateBlock(index, 'load_kg', value)} />
                            <LabelledInput label="RIR" type="number" value={block.rir} onChange={(value) => updateBlock(index, 'rir', value)} />
                          </div>
                          {exercise ? (
                            <div className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-600">
                              Target {exercise.rep_target_min}-{exercise.rep_target_max} reps, then jump {exercise.load_increment} kg when the lift is ready.
                            </div>
                          ) : null}
                        </div>
                      </div>
                    )
                  })}
                </div>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <ActionButton tone="secondary" onClick={() => addBlock()} className="w-full sm:w-auto">Add lift</ActionButton>
                  <ActionButton
                    tone="secondary"
                    onClick={() => {
                      const lastBlock = sessionDraft.blocks[sessionDraft.blocks.length - 1]
                      addBlock(lastBlock ?? undefined)
                    }}
                    className="w-full sm:w-auto"
                  >
                    Copy last lift
                  </ActionButton>
                  <ActionButton type="submit" className="w-full sm:w-auto">{editingSessionId ? 'Save workout changes' : 'Log workout'}</ActionButton>
                  {editingSessionId ? <ActionButton tone="secondary" onClick={() => { setEditingSessionId(null); setSessionDraft({ notes: '', perceived_energy: '', bodyweight_kg: '', blocks: [createSessionBlockDraft()] }) }} className="w-full sm:w-auto">Cancel edit</ActionButton> : null}
                </div>

                <details className="rounded-[22px] border border-slate-200 bg-white">
                  <summary className="cursor-pointer list-none px-4 py-4">
                    <div className="font-semibold text-slate-950">Advanced session details</div>
                    <div className="mt-1 text-sm text-slate-500">Optional readiness and bodyweight context for better coaching.</div>
                  </summary>
                  <div className="border-t border-slate-200 px-4 py-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <LabelledInput
                        label="Perceived energy (1-10)"
                        type="number"
                        value={sessionDraft.perceived_energy}
                        onChange={(value) => setSessionDraft((current) => ({ ...current, perceived_energy: value }))}
                      />
                      <LabelledInput
                        label="Bodyweight kg"
                        type="number"
                        step="0.1"
                        value={sessionDraft.bodyweight_kg}
                        onChange={(value) => setSessionDraft((current) => ({ ...current, bodyweight_kg: value }))}
                      />
                    </div>
                  </div>
                </details>
              </form>
            </div>
          </Panel>

          <Panel title="Recent workouts" subtitle="Check what you actually did without opening a dense history view.">
            <div className="space-y-3">
              {recentSessions.map((session) => (
                <div key={session.id} className="rounded-[24px] bg-slate-950 px-4 py-4 text-canvas">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-display text-xl">{session.notes || 'Workout session'}</div>
                      <div className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-400">{new Date(session.started_at).toLocaleString()}</div>
                    </div>
                    <div className="rounded-full bg-white/10 px-3 py-2 text-sm">{Math.round(session.total_volume_kg)} kg</div>
                  </div>
                  <div className="mt-3 text-sm text-slate-300">
                    {summarizeSession(session, exerciseNameById) || `${session.total_sets} working sets logged`}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <ActionButton tone="secondary" onClick={() => repeatSession(session)} className="w-auto">Repeat</ActionButton>
                    <ActionButton
                      tone="secondary"
                      onClick={() => {
                        setEditingSessionId(session.id)
                        const blocks = buildBlocksFromSession(session)
                        setSessionDraft({
                          notes: session.notes ?? '',
                          perceived_energy: session.perceived_energy != null ? String(session.perceived_energy) : '',
                          bodyweight_kg: session.bodyweight_kg != null ? String(session.bodyweight_kg) : '',
                          blocks: blocks.length ? blocks : [createSessionBlockDraft()],
                        })
                        if (blocks[0]?.exercise_id) {
                          setSelectedExerciseId(blocks[0].exercise_id)
                        }
                      }}
                      className="w-auto"
                    >
                      Edit
                    </ActionButton>
                    <ActionButton tone="secondary" onClick={() => deleteSession.mutate(session.id)} className="w-auto">Delete</ActionButton>
                  </div>
                </div>
              ))}
              {!recentSessions.length ? <EmptyState title="No workouts yet" body="The first log unlocks repeat-last-session shortcuts and better overload context." /> : null}
            </div>
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="Overload coach" subtitle="Pick a lift to see what the next session should probably look like.">
            <div className="flex flex-wrap gap-2">
              {(draftExerciseIds.length ? draftExerciseIds : quickExercises.map((exercise) => exercise.id)).map((exerciseId) => (
                <button
                  key={exerciseId}
                  type="button"
                  className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                    selectedExerciseId === exerciseId ? 'bg-amber-400 text-slate-950' : 'bg-slate-100 text-slate-700'
                  }`}
                  onClick={() => setSelectedExerciseId(exerciseId)}
                >
                  {exerciseNameById[exerciseId] ?? 'Exercise'}
                </button>
              ))}
            </div>

            {progressionRecommendation ? (
              <div className="mt-4 space-y-3">
                <div className="rounded-[24px] bg-lime p-5 text-slate-950">
                  <div className="text-xs uppercase tracking-[0.25em] text-slate-700">Next action</div>
                  <div className="mt-2 font-display text-3xl">{progressionRecommendation.recommendation}</div>
                  <div className="mt-3 text-sm">Target next load: {progressionRecommendation.next_load_kg} kg</div>
                  <p className="mt-3 text-sm leading-6">{progressionRecommendation.reason}</p>
                </div>

                <div className="rounded-[24px] bg-slate-100 p-4 text-sm text-slate-700">
                  <div className="font-semibold text-slate-950">{selectedExercise?.name ?? 'Selected exercise'}</div>
                  <div className="mt-2">This call already folds in recent performance, target rep range, and the latest recovery context available to the backend.</div>
                </div>
              </div>
            ) : (
              <div className="mt-4">
                <EmptyState title="Pick an exercise" body="Select a lift from the workout draft or your library to inspect the progression recommendation." />
              </div>
            )}
          </Panel>

          <Panel title="Saved templates" subtitle="These stay available for one-tap session setup.">
            <div className="space-y-3">
              {quickTemplates.map((template) => (
                <div key={template.id} className="rounded-[24px] border border-slate-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-slate-950">{template.name}</div>
                      <div className="mt-1 text-sm text-slate-500">{template.items.length} lift slots</div>
                    </div>
                    <ActionButton tone="secondary" onClick={() => applyTemplate(template)} className="w-auto">Use</ActionButton>
                  </div>
                </div>
              ))}
              {!quickTemplates.length ? <EmptyState title="No templates yet" body="Build repeatable sessions in Templates and they will show up here as quick starts." /> : null}
            </div>
          </Panel>

          <details className="rounded-[24px] border border-slate-200 bg-white/90 shadow-halo">
            <summary className="cursor-pointer list-none px-4 py-4">
              <div className="font-display text-xl text-slate-950">Exercise setup</div>
              <div className="mt-1 text-sm text-slate-500">Create a lift once so the app knows the rep range and load jump rules.</div>
            </summary>
            <div className="border-t border-slate-200 px-4 py-4">
              <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); createExercise.mutate() }}>
                <LabelledInput label="Exercise name" value={exerciseDraft.name} onChange={(value) => setExerciseDraft((current) => ({ ...current, name: value }))} />
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <LabelledInput label="Rep min" type="number" value={exerciseDraft.rep_target_min} onChange={(value) => setExerciseDraft((current) => ({ ...current, rep_target_min: value }))} />
                  <LabelledInput label="Rep max" type="number" value={exerciseDraft.rep_target_max} onChange={(value) => setExerciseDraft((current) => ({ ...current, rep_target_max: value }))} />
                  <LabelledInput label="Load jump" type="number" step="0.5" value={exerciseDraft.load_increment} onChange={(value) => setExerciseDraft((current) => ({ ...current, load_increment: value }))} />
                </div>
                <ActionButton type="submit" className="sm:w-auto">Save exercise</ActionButton>
              </form>

              <div className="mt-4 space-y-2">
                {quickExercises.map((exercise) => (
                  <button
                    key={exercise.id}
                    type="button"
                    className="w-full rounded-2xl bg-slate-50 px-4 py-3 text-left text-sm transition hover:bg-amber-50"
                    onClick={() => setSelectedExerciseId(exercise.id)}
                  >
                    <div className="font-semibold text-slate-950">{exercise.name}</div>
                    <div className="mt-1 text-slate-500">{exercise.rep_target_min}-{exercise.rep_target_max} reps, +{exercise.load_increment} kg</div>
                  </button>
                ))}
              </div>
            </div>
          </details>
        </div>
      </div>
    </div>
  )
}
