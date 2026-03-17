import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'

import { CoachNudgePanel, filterCoachNudges } from '../../components/coach-panels'
import { ActionButton, ConfirmSheet, type ConfirmSheetRequest, DraftStatusBanner, EmptyState, ErrorState, LabelledInput, LabelledSelect, LoadingState, PageIntro, Panel } from '../../components/ui'
import { api, type Routine, type WorkoutSession, type WorkoutTemplate } from '../../lib/api'
import { useDraftState } from '../../lib/draft-store'
import { queryClient } from '../../lib/query-client'
import { useWeightUnit } from '../../lib/user-preferences'
import { convertMassToKg, formatMass, formatMassInput, getWeightUnitLabel, type WeightUnit } from '../../lib/weight-units'

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

type RoutineExerciseDraft = {
  exercise_id: string
  day_label: string
  target_sets: string
  target_reps_min: string
  target_reps_max: string
  target_rir: string
}

type RoutineDraft = {
  name: string
  goal: string
  schedule_notes: string
  notes: string
  items: RoutineExerciseDraft[]
}

function defaultLoadIncrementForUnit(weightUnit: WeightUnit) {
  return weightUnit === 'lbs' ? '5' : '2.5'
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

function createRoutineExerciseDraft(): RoutineExerciseDraft {
  return {
    exercise_id: '',
    day_label: 'Day 1',
    target_sets: '3',
    target_reps_min: '6',
    target_reps_max: '10',
    target_rir: '2',
  }
}

function buildBlocksFromRoutine(routine: Routine, dayLabel: string): SessionBlockDraft[] {
  return routine.items
    .filter((item) => item.day_label === dayLabel)
    .map((item) => ({
      exercise_id: item.exercise_id,
      target_sets: String(item.target_sets),
      reps: String(item.target_reps_max),
      load_kg: '0',
      rir: item.target_rir != null ? String(item.target_rir) : '2',
    }))
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

function buildBlocksFromSession(session: WorkoutSession, weightUnit: WeightUnit): SessionBlockDraft[] {
  const grouped = new Map<string, SessionBlockDraft>()
  const order: string[] = []

  for (const entry of session.sets) {
    if (!grouped.has(entry.exercise_id)) {
      grouped.set(entry.exercise_id, {
        exercise_id: entry.exercise_id,
        target_sets: '0',
        reps: String(entry.reps),
        load_kg: formatMassInput(entry.load_kg, weightUnit),
        rir: String(entry.rir ?? 2),
      })
      order.push(entry.exercise_id)
    }

    const current = grouped.get(entry.exercise_id)
    if (!current) continue
    current.target_sets = String(Number(current.target_sets) + 1)
    current.reps = String(entry.reps)
    current.load_kg = formatMassInput(entry.load_kg, weightUnit)
    current.rir = String(entry.rir ?? 2)
  }

  return order.map((exerciseId) => grouped.get(exerciseId) ?? createSessionBlockDraft(exerciseId))
}

function expandBlocksToSets(blocks: SessionBlockDraft[], weightUnit: WeightUnit) {
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
      load_kg: convertMassToKg(Number(block.load_kg) || 0, weightUnit),
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

function toStartOfDayIso(value: string) {
  return value ? `${value}T00:00:00` : undefined
}

function toEndOfDayIso(value: string) {
  return value ? `${value}T23:59:59` : undefined
}

export function TrainingPage() {
  const weightUnit = useWeightUnit()
  const weightUnitLabel = getWeightUnitLabel(weightUnit)
  const feedQuery = useQuery({ queryKey: ['assistant-feed'], queryFn: api.getAssistantFeed, retry: false })
  const [exerciseSearch, setExerciseSearch] = useState('')
  const [sessionFilters, setSessionFilters] = useState({ date_from: '', date_to: '', template_id: '' })
  const exercisesQuery = useQuery({ queryKey: ['exercises'], queryFn: api.listExercises })
  const sessionsQuery = useQuery({
    queryKey: ['workout-sessions', sessionFilters.date_from, sessionFilters.date_to, sessionFilters.template_id],
    queryFn: () => api.listWorkoutSessions({
      limit: 12,
      date_from: toStartOfDayIso(sessionFilters.date_from),
      date_to: toEndOfDayIso(sessionFilters.date_to),
      template_id: sessionFilters.template_id || undefined,
    }),
  })
  const routinesQuery = useQuery({ queryKey: ['routines'], queryFn: api.listRoutines })
  const templatesQuery = useQuery({ queryKey: ['workout-templates'], queryFn: api.listWorkoutTemplates })
  const [selectedExerciseId, setSelectedExerciseId] = useState('')
  const [exerciseDraft, setExerciseDraft] = useState<ExerciseDraft>({
    name: '',
    rep_target_min: '6',
    rep_target_max: '10',
    load_increment: defaultLoadIncrementForUnit('kg'),
  })
  const sessionDraftState = useDraftState({
    formId: 'training-session-draft',
    initialValue: {
      routine_id: '',
      notes: '',
      perceived_energy: '',
      bodyweight_kg: '',
      blocks: [createSessionBlockDraft()],
    },
    route: '/training',
  })
  const sessionDraft = sessionDraftState.value
  const setSessionDraft = sessionDraftState.setValue
  const routineDraftState = useDraftState<RoutineDraft>({
    formId: 'training-routine-draft',
    initialValue: {
      name: '',
      goal: '',
      schedule_notes: '',
      notes: '',
      items: [createRoutineExerciseDraft()],
    },
    route: '/training',
  })
  const routineDraft = routineDraftState.value
  const setRoutineDraft = routineDraftState.setValue
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [confirmRequest, setConfirmRequest] = useState<ConfirmSheetRequest | null>(null)

  useEffect(() => {
    setExerciseDraft((current) => (
      !current.name
      && current.rep_target_min === '6'
      && current.rep_target_max === '10'
        ? { ...current, load_increment: defaultLoadIncrementForUnit(weightUnit) }
        : current
    ))
  }, [weightUnit])

  const exercises = exercisesQuery.data?.items ?? []
  const sessions = sessionsQuery.data?.items ?? []
  const routines = routinesQuery.data?.items ?? []
  const templates = templatesQuery.data?.items ?? []

  const exerciseNameById = useMemo(
    () => Object.fromEntries(exercises.map((exercise) => [exercise.id, exercise.name])),
    [exercises],
  )

  const draftExerciseIds = useMemo(
    () => Array.from(new Set(sessionDraft.blocks.map((block) => block.exercise_id).filter(Boolean))),
    [sessionDraft.blocks],
  )

  const filteredExercises = useMemo(() => exercises.filter((exercise) => exercise.name.toLowerCase().includes(exerciseSearch.toLowerCase())), [exerciseSearch, exercises])
  const quickExercises = useMemo(() => filteredExercises.slice(0, 12), [filteredExercises])
  const quickRoutines = useMemo(() => routines.slice(0, 4), [routines])
  const recentSessions = useMemo(() => sessions.slice(0, 4), [sessions])
  const quickTemplates = useMemo(() => templates.slice(0, 4), [templates])
  const routineNameById = useMemo(
    () => Object.fromEntries(routines.map((routine) => [routine.id, routine.name])),
    [routines],
  )
  const routineStats = useMemo(() => {
    const cutoff = Date.now() - (7 * 24 * 60 * 60 * 1000)
    return Object.fromEntries(routines.map((routine) => {
      const plannedDays = new Set(routine.items.map((item) => item.day_label)).size
      const recentCount = sessions.filter((session) =>
        session.routine_id === routine.id && new Date(session.started_at).getTime() >= cutoff).length
      return [routine.id, { plannedDays, recentCount }]
    }))
  }, [routines, sessions])
  const trainingNudges = useMemo(() => filterCoachNudges(feedQuery.data?.feed.nudges, 'training'), [feedQuery.data?.feed.nudges])

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
      load_increment: convertMassToKg(Number(exerciseDraft.load_increment), weightUnit),
    }),
    onSuccess: async () => {
      setExerciseDraft({ name: '', rep_target_min: '6', rep_target_max: '10', load_increment: defaultLoadIncrementForUnit(weightUnit) })
      await queryClient.invalidateQueries({ queryKey: ['exercises'] })
    },
  })

  const createRoutine = useMutation({
    mutationFn: () => api.createRoutine({
      name: routineDraft.name,
      goal: routineDraft.goal || undefined,
      schedule_notes: routineDraft.schedule_notes || undefined,
      notes: routineDraft.notes || undefined,
      items: routineDraft.items
        .filter((item) => item.exercise_id)
        .map((item, index) => ({
          exercise_id: item.exercise_id,
          day_label: item.day_label || 'Day 1',
          order_index: index,
          target_sets: Number(item.target_sets),
          target_reps_min: Number(item.target_reps_min),
          target_reps_max: Number(item.target_reps_max),
          target_rir: item.target_rir ? Number(item.target_rir) : null,
        })),
    }),
    onSuccess: async () => {
      routineDraftState.meta.clearDraft()
      await queryClient.invalidateQueries({ queryKey: ['routines'] })
    },
  })

  const deleteRoutine = useMutation({
    mutationFn: (routineId: string) => api.deleteRoutine(routineId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['routines'] }),
        queryClient.invalidateQueries({ queryKey: ['workout-templates'] }),
      ])
    },
  })

  const saveSession = useMutation({
    mutationFn: () => (editingSessionId ? api.updateWorkoutSession(editingSessionId, {
      routine_id: sessionDraft.routine_id || undefined,
      notes: sessionDraft.notes || undefined,
      perceived_energy: sessionDraft.perceived_energy ? Number(sessionDraft.perceived_energy) : undefined,
      bodyweight_kg: sessionDraft.bodyweight_kg ? convertMassToKg(Number(sessionDraft.bodyweight_kg), weightUnit) : undefined,
      sets: expandBlocksToSets(sessionDraft.blocks, weightUnit),
    }) : api.createWorkoutSession({
      routine_id: sessionDraft.routine_id || undefined,
      notes: sessionDraft.notes || undefined,
      perceived_energy: sessionDraft.perceived_energy ? Number(sessionDraft.perceived_energy) : undefined,
      bodyweight_kg: sessionDraft.bodyweight_kg ? convertMassToKg(Number(sessionDraft.bodyweight_kg), weightUnit) : undefined,
      sets: expandBlocksToSets(sessionDraft.blocks, weightUnit),
    })),
    onSuccess: async () => {
      sessionDraftState.meta.clearDraft()
      setEditingSessionId(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['workout-sessions'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['insights'] }),
        queryClient.invalidateQueries({ queryKey: ['insights-summary'] }),
        queryClient.invalidateQueries({ queryKey: ['exercise-progression'] }),
      ])
    },
  })

  const deleteSession = useMutation({
    mutationFn: (sessionId: string) => api.deleteWorkoutSession(sessionId),
    onSuccess: async (_, sessionId) => {
      if (editingSessionId === sessionId) {
        setEditingSessionId(null)
        sessionDraftState.meta.clearDraft()
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['workout-sessions'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['insights'] }),
        queryClient.invalidateQueries({ queryKey: ['insights-summary'] }),
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
      routine_id: template.routine_id ?? '',
      notes: template.name,
      blocks: blocks.length ? blocks : [createSessionBlockDraft()],
    }))

    if (blocks[0]?.exercise_id) {
      setSelectedExerciseId(blocks[0].exercise_id)
    }
  }

  function repeatSession(session: WorkoutSession) {
    const blocks = buildBlocksFromSession(session, weightUnit)
    setEditingSessionId(null)
    setSessionDraft((current) => ({
      ...current,
      routine_id: session.routine_id ?? '',
      notes: session.notes ?? 'Repeat session',
      perceived_energy: session.perceived_energy != null ? String(session.perceived_energy) : current.perceived_energy,
      bodyweight_kg: session.bodyweight_kg != null ? formatMassInput(session.bodyweight_kg, weightUnit) : current.bodyweight_kg,
      blocks: blocks.length ? blocks : [createSessionBlockDraft()],
    }))

    if (blocks[0]?.exercise_id) {
      setSelectedExerciseId(blocks[0].exercise_id)
    }
  }

  function launchRoutineDay(routine: Routine, dayLabel: string) {
    const blocks = buildBlocksFromRoutine(routine, dayLabel)
    setEditingSessionId(null)
    setSessionDraft({
      routine_id: routine.id,
      notes: `${routine.name} - ${dayLabel}`,
      perceived_energy: '',
      bodyweight_kg: '',
      blocks: blocks.length ? blocks : [createSessionBlockDraft()],
    })
    if (blocks[0]?.exercise_id) {
      setSelectedExerciseId(blocks[0].exercise_id)
    }
  }

  const sessionHasValidBlock = sessionDraft.blocks.some((block) =>
    Boolean(block.exercise_id) && Number(block.target_sets) > 0 && Number(block.reps) > 0 && Number(block.load_kg) >= 0)
  const sessionBodyweightError = sessionDraft.bodyweight_kg && Number(sessionDraft.bodyweight_kg) <= 0
    ? 'Bodyweight must be greater than zero.'
    : ''
  const sessionEnergyError = sessionDraft.perceived_energy && (Number(sessionDraft.perceived_energy) < 1 || Number(sessionDraft.perceived_energy) > 10)
    ? 'Perceived energy must stay between 1 and 10.'
    : ''
  const exerciseDraftError = !exerciseDraft.name.trim()
    ? 'Exercise name is required.'
    : Number(exerciseDraft.rep_target_min) <= 0 || Number(exerciseDraft.rep_target_max) < Number(exerciseDraft.rep_target_min)
      ? 'Rep max must be greater than or equal to rep min.'
      : Number(exerciseDraft.load_increment) <= 0
        ? 'Load jump must be greater than zero.'
        : ''
  const routineDraftError = !routineDraft.name.trim() || !routineDraft.items.some((item) => item.exercise_id)
    ? 'Add a routine name and at least one exercise slot.'
    : ''
  const progressionRecommendation = progressionQuery.data?.recommendation
  const selectedExercise = exercises.find((exercise) => exercise.id === selectedExerciseId)

  return (
    <div className="space-y-4">
      <PageIntro
        eyebrow="Training"
        title="Log the workout while it is happening"
        description="Start from a template, repeat the last session, or log lifts manually."
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <div className="space-y-4">
          <CoachNudgePanel
            title="Coach cues"
            subtitle="Quick training notes."
            nudges={trainingNudges}
            emptyTitle="No training cues right now"
            emptyBody="Coach notes will show up here when needed."
          />

          <Panel title={"Start today's workout"} subtitle="Fast starts first.">
            <div className="space-y-4">
              <div className="space-y-3">
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Quick starts</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {quickRoutines.map((routine) => (
                    <div key={routine.id} className="rounded-[22px] border border-slate-200 bg-lime/15 px-4 py-4">
                      <div className="font-semibold text-slate-950">{routine.name}</div>
                      <div className="mt-1 text-sm text-slate-500">
                        {routineStats[routine.id]?.recentCount ?? 0} sessions in the last 7 days / {routineStats[routine.id]?.plannedDays ?? 0} planned days
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {Array.from(new Set(routine.items.map((item) => item.day_label))).map((dayLabel) => (
                          <ActionButton key={`${routine.id}-${dayLabel}`} tone="secondary" onClick={() => launchRoutineDay(routine, dayLabel)} className="w-auto">
                            {dayLabel}
                          </ActionButton>
                        ))}
                      </div>
                    </div>
                  ))}
                  {quickTemplates.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4 text-left transition hover:border-amber-300 hover:bg-amber-50"
                      onClick={() => applyTemplate(template)}
                    >
                      <div className="font-semibold text-slate-950">{template.name}</div>
                      <div className="mt-1 text-sm text-slate-500">
                        {template.items.length} lift slots{template.routine_id ? ` / ${routineNameById[template.routine_id] ?? 'Routine linked'}` : ''}
                      </div>
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
                      <div className="mt-1 text-sm text-slate-500">
                        {summarizeSession(session, exerciseNameById) || `${session.total_sets} sets`}
                        {session.routine_id ? ` / ${routineNameById[session.routine_id] ?? 'Routine session'}` : ''}
                      </div>
                    </button>
                  ))}
                </div>
                {!quickRoutines.length && !quickTemplates.length && !recentSessions.length ? (
                  <EmptyState title="No quick starts yet" body="Log a session or save a template to fill this in." />
                ) : null}
              </div>

              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (sessionHasValidBlock && !sessionBodyweightError && !sessionEnergyError) {
                    saveSession.mutate()
                  }
                }}
              >
                <DraftStatusBanner restored={sessionDraftState.meta.restored} savedAt={sessionDraftState.meta.savedAt} onDiscard={() => { setEditingSessionId(null); sessionDraftState.meta.clearDraft() }} />
                {sessionDraft.routine_id ? (
                  <div className="rounded-[20px] bg-lime/15 px-4 py-3 text-sm text-slate-700">
                    Routine session: {routineNameById[sessionDraft.routine_id] ?? 'Custom routine'}
                  </div>
                ) : null}
                <LabelledInput
                  label={editingSessionId ? 'Session label or notes (editing)' : 'Session label or notes'}
                  value={sessionDraft.notes}
                  onChange={(value) => setSessionDraft((current) => ({ ...current, notes: value }))}
                  placeholder="Push day, hotel gym, upper"
                />
                <LabelledInput label="Search exercises" value={exerciseSearch} onChange={setExerciseSearch} placeholder="Search exercises" />

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
                              ...filteredExercises.map((exerciseItem) => ({ label: exerciseItem.name, value: exerciseItem.id })),
                            ]}
                            error={!block.exercise_id ? 'Choose an exercise.' : undefined}
                          />
                          <div className="grid grid-cols-2 gap-3">
                            <LabelledInput label="Sets" type="number" value={block.target_sets} onChange={(value) => updateBlock(index, 'target_sets', value)} error={Number(block.target_sets) > 0 ? undefined : 'Sets must be greater than zero.'} />
                            <LabelledInput label="Reps" type="number" value={block.reps} onChange={(value) => updateBlock(index, 'reps', value)} error={Number(block.reps) > 0 ? undefined : 'Reps must be greater than zero.'} />
                            <LabelledInput label={`Load ${weightUnitLabel}`} type="number" value={block.load_kg} onChange={(value) => updateBlock(index, 'load_kg', value)} error={Number(block.load_kg) >= 0 ? undefined : 'Load cannot be negative.'} />
                            <LabelledInput label="RIR" type="number" value={block.rir} onChange={(value) => updateBlock(index, 'rir', value)} />
                          </div>
                          {exercise ? (
                            <div className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-600">
                              Target {exercise.rep_target_min}-{exercise.rep_target_max} reps, then jump {formatMass(exercise.load_increment, weightUnit)} when the lift is ready.
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
                  <ActionButton type="submit" className="w-full sm:w-auto" disabled={saveSession.isPending || !sessionHasValidBlock || Boolean(sessionBodyweightError) || Boolean(sessionEnergyError)}>
                    {saveSession.isPending ? 'Saving...' : (editingSessionId ? 'Save workout changes' : 'Log workout')}
                  </ActionButton>
                  {editingSessionId ? <ActionButton tone="secondary" onClick={() => { setEditingSessionId(null); sessionDraftState.meta.clearDraft() }} className="w-full sm:w-auto">Cancel edit</ActionButton> : null}
                </div>

                <details className="rounded-[22px] border border-slate-200 bg-white">
                  <summary className="cursor-pointer list-none px-4 py-4">
                    <div className="font-semibold text-slate-950">Advanced session details</div>
                    <div className="mt-1 text-sm text-slate-500">Optional recovery context.</div>
                  </summary>
                  <div className="border-t border-slate-200 px-4 py-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <LabelledInput
                        label="Perceived energy (1-10)"
                        type="number"
                        value={sessionDraft.perceived_energy}
                        onChange={(value) => setSessionDraft((current) => ({ ...current, perceived_energy: value }))}
                        error={sessionEnergyError || undefined}
                      />
                      <LabelledInput
                        label={`Bodyweight ${weightUnitLabel}`}
                        type="number"
                        step="0.1"
                        value={sessionDraft.bodyweight_kg}
                        onChange={(value) => setSessionDraft((current) => ({ ...current, bodyweight_kg: value }))}
                        error={sessionBodyweightError || undefined}
                      />
                    </div>
                  </div>
                </details>
              </form>
            </div>
          </Panel>

          <Panel title="Recent workouts" subtitle="Latest sessions.">
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <LabelledInput label="From" type="date" value={sessionFilters.date_from} onChange={(value) => setSessionFilters((current) => ({ ...current, date_from: value }))} />
                <LabelledInput label="To" type="date" value={sessionFilters.date_to} onChange={(value) => setSessionFilters((current) => ({ ...current, date_to: value }))} />
                <LabelledSelect
                  label="Template"
                  value={sessionFilters.template_id}
                  onChange={(value) => setSessionFilters((current) => ({ ...current, template_id: value }))}
                  options={[
                    { label: 'All templates', value: '' },
                    ...templates.map((template) => ({ label: template.name, value: template.id })),
                  ]}
                />
              </div>
              {sessionsQuery.isLoading ? (
                <LoadingState title="Loading workouts" body="Loading recent sessions." />
              ) : sessionsQuery.isError ? (
                <ErrorState title="Could not load recent workouts" body={sessionsQuery.error.message} action={<ActionButton onClick={() => sessionsQuery.refetch()} className="w-auto">Retry</ActionButton>} />
              ) : (
                <div className="space-y-3">
                  {recentSessions.map((session) => (
                    <div key={session.id} className="rounded-[24px] bg-slate-950 px-4 py-4 text-canvas">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-display text-xl">{session.notes || 'Workout session'}</div>
                          <div className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-400">{new Date(session.started_at).toLocaleString()}</div>
                          {session.routine_id ? <div className="mt-2 text-sm text-slate-300">{routineNameById[session.routine_id] ?? 'Routine session'}</div> : null}
                        </div>
                        <div className="rounded-full bg-white/10 px-3 py-2 text-sm">
                          {'sync_status' in session && session.sync_status === 'queued' ? 'Queued sync' : formatMass(session.total_volume_kg, weightUnit, { decimals: 0 })}
                        </div>
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
                            const blocks = buildBlocksFromSession(session, weightUnit)
                            setSessionDraft({
                              routine_id: session.routine_id ?? '',
                              notes: session.notes ?? '',
                              perceived_energy: session.perceived_energy != null ? String(session.perceived_energy) : '',
                              bodyweight_kg: session.bodyweight_kg != null ? formatMassInput(session.bodyweight_kg, weightUnit) : '',
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
                        <ActionButton
                          tone="secondary"
                          onClick={() => setConfirmRequest({
                            title: 'Delete this workout?',
                            body: `Type ${session.notes || 'Workout session'} to confirm deleting it.`,
                            confirmLabel: 'Delete workout',
                            confirmationValue: session.notes || 'Workout session',
                            confirmationHint: `Type ${session.notes || 'Workout session'} to confirm`,
                            isPending: deleteSession.isPending,
                            onConfirm: () => deleteSession.mutate(session.id),
                          })}
                          className="w-auto"
                        >
                          Delete
                        </ActionButton>
                      </div>
                    </div>
                  ))}
                  {!recentSessions.length ? <EmptyState title="No workouts yet" body="Log a workout to get started." /> : null}
                </div>
              )}
            </div>
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="Overload coach" subtitle="Progression at a glance.">
            <div className="space-y-3">
            <LabelledInput label="Search exercises" value={exerciseSearch} onChange={setExerciseSearch} placeholder="Search exercises" />
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
            </div>

            {progressionRecommendation ? (
              <div className="mt-4 space-y-3">
                <div className="rounded-[24px] bg-lime p-5 text-slate-950">
                  <div className="text-xs uppercase tracking-[0.25em] text-slate-700">Next action</div>
                  <div className="mt-2 font-display text-3xl">{progressionRecommendation.recommendation}</div>
                  <div className="mt-3 text-sm">Target next load: {formatMass(progressionRecommendation.next_load_kg, weightUnit)}</div>
                  <p className="mt-3 text-sm leading-6">{progressionRecommendation.reason}</p>
                </div>

                <div className="rounded-[24px] bg-slate-100 p-4 text-sm text-slate-700">
                  <div className="font-semibold text-slate-950">{selectedExercise?.name ?? 'Selected exercise'}</div>
                  <div className="mt-2">This call already folds in recent performance, target rep range, and the latest recovery context available to the backend.</div>
                </div>
              </div>
            ) : (
              <div className="mt-4">
                <EmptyState title="Pick an exercise" body="Select a lift to see the recommendation." />
              </div>
            )}
          </Panel>

          <Panel title="Saved templates" subtitle="Ready to use.">
            <div className="space-y-3">
              {quickTemplates.map((template) => (
                <div key={template.id} className="rounded-[24px] border border-slate-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-slate-950">{template.name}</div>
                      <div className="mt-1 text-sm text-slate-500">
                        {template.items.length} lift slots{template.routine_id ? ` / ${routineNameById[template.routine_id] ?? 'Routine linked'}` : ''}
                      </div>
                    </div>
                    <ActionButton tone="secondary" onClick={() => applyTemplate(template)} className="w-auto">Use</ActionButton>
                  </div>
                </div>
              ))}
              {!quickTemplates.length ? <EmptyState title="No templates yet" body="Saved workout templates will show up here." /> : null}
            </div>
          </Panel>

          <Panel title="Routines" subtitle="Launch routine days fast.">
            <div className="space-y-3">
              {quickRoutines.map((routine) => (
                <div key={routine.id} className="rounded-[24px] border border-slate-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-slate-950">{routine.name}</div>
                      <div className="mt-1 text-sm text-slate-500">
                        {routineStats[routine.id]?.recentCount ?? 0} sessions in the last 7 days / {routineStats[routine.id]?.plannedDays ?? 0} planned days
                      </div>
                    </div>
                    <ActionButton
                      tone="secondary"
                      onClick={() => setConfirmRequest({
                        title: 'Delete this routine?',
                        body: `Type ${routine.name} to confirm deleting this routine.`,
                        confirmLabel: 'Delete routine',
                        confirmationValue: routine.name,
                        confirmationHint: `Type ${routine.name} to confirm`,
                        isPending: deleteRoutine.isPending,
                        onConfirm: () => deleteRoutine.mutate(routine.id),
                      })}
                      className="w-auto"
                    >
                      Delete
                    </ActionButton>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {Array.from(new Set(routine.items.map((item) => item.day_label))).map((dayLabel) => (
                      <ActionButton key={`${routine.id}-${dayLabel}`} tone="secondary" onClick={() => launchRoutineDay(routine, dayLabel)} className="w-auto">
                        Start {dayLabel}
                      </ActionButton>
                    ))}
                  </div>
                </div>
              ))}
              {!quickRoutines.length ? <EmptyState title="No routines yet" body="Create a routine to fill this in." /> : null}
            </div>
          </Panel>

          <details className="rounded-[24px] border border-slate-200 bg-white/90 shadow-halo">
            <summary className="cursor-pointer list-none px-4 py-4">
              <div className="font-display text-xl text-slate-950">Routine builder</div>
              <div className="mt-1 text-sm text-slate-500">Build routine days once.</div>
            </summary>
            <div className="border-t border-slate-200 px-4 py-4">
              <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); if (!routineDraftError) { createRoutine.mutate() } }}>
                <DraftStatusBanner restored={routineDraftState.meta.restored} savedAt={routineDraftState.meta.savedAt} onDiscard={routineDraftState.meta.clearDraft} />
                <LabelledInput label="Routine name" value={routineDraft.name} onChange={(value) => setRoutineDraft((current) => ({ ...current, name: value }))} placeholder="Upper / lower" />
                <LabelledInput label="Goal" value={routineDraft.goal} onChange={(value) => setRoutineDraft((current) => ({ ...current, goal: value }))} placeholder="Hypertrophy" />
                <LabelledInput label="Schedule notes" value={routineDraft.schedule_notes} onChange={(value) => setRoutineDraft((current) => ({ ...current, schedule_notes: value }))} placeholder="Mon Wed Fri" />
                <LabelledInput label="Notes" value={routineDraft.notes} onChange={(value) => setRoutineDraft((current) => ({ ...current, notes: value }))} placeholder="Compounds first" />
                {routineDraft.items.map((item, index) => (
                  <div key={index} className="rounded-[22px] bg-slate-50 p-4 ring-1 ring-slate-200">
                    <div className="grid gap-3">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <LabelledInput label="Day label" value={item.day_label} onChange={(value) => setRoutineDraft((current) => {
                          const items = [...current.items]
                          items[index] = { ...items[index], day_label: value }
                          return { ...current, items }
                        })} />
                        <LabelledSelect
                          label="Exercise"
                          value={item.exercise_id}
                          onChange={(value) => setRoutineDraft((current) => {
                            const items = [...current.items]
                            items[index] = { ...items[index], exercise_id: value }
                            return { ...current, items }
                          })}
                          options={[
                            { label: 'Select exercise', value: '' },
                            ...filteredExercises.map((exercise) => ({ label: exercise.name, value: exercise.id })),
                          ]}
                          error={!item.exercise_id ? 'Choose an exercise.' : undefined}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <LabelledInput label="Sets" type="number" value={item.target_sets} onChange={(value) => setRoutineDraft((current) => {
                          const items = [...current.items]
                          items[index] = { ...items[index], target_sets: value }
                          return { ...current, items }
                        })} />
                        <LabelledInput label="Target RIR" type="number" value={item.target_rir} onChange={(value) => setRoutineDraft((current) => {
                          const items = [...current.items]
                          items[index] = { ...items[index], target_rir: value }
                          return { ...current, items }
                        })} />
                        <LabelledInput label="Rep min" type="number" value={item.target_reps_min} onChange={(value) => setRoutineDraft((current) => {
                          const items = [...current.items]
                          items[index] = { ...items[index], target_reps_min: value }
                          return { ...current, items }
                        })} />
                        <LabelledInput label="Rep max" type="number" value={item.target_reps_max} onChange={(value) => setRoutineDraft((current) => {
                          const items = [...current.items]
                          items[index] = { ...items[index], target_reps_max: value }
                          return { ...current, items }
                        })} />
                      </div>
                      <ActionButton tone="secondary" onClick={() => setRoutineDraft((current) => ({
                        ...current,
                        items: current.items.length === 1 ? [createRoutineExerciseDraft()] : current.items.filter((_, itemIndex) => itemIndex !== index),
                      }))} className="w-full sm:w-auto">
                        Remove routine item
                      </ActionButton>
                    </div>
                  </div>
                ))}
                <div className="flex flex-col gap-2 sm:flex-row">
                  <ActionButton tone="secondary" onClick={() => setRoutineDraft((current) => ({ ...current, items: [...current.items, createRoutineExerciseDraft()] }))} className="w-full sm:w-auto">
                    Add day slot
                  </ActionButton>
                  <ActionButton type="submit" className="w-full sm:w-auto" disabled={Boolean(routineDraftError) || createRoutine.isPending}>
                    {createRoutine.isPending ? 'Saving...' : 'Save routine'}
                  </ActionButton>
                </div>
                {routineDraftError ? <div className="app-status app-status-danger rounded-[22px] px-4 py-3 text-sm">{routineDraftError}</div> : null}
              </form>
            </div>
          </details>

          <details className="rounded-[24px] border border-slate-200 bg-white/90 shadow-halo">
            <summary className="cursor-pointer list-none px-4 py-4">
              <div className="font-display text-xl text-slate-950">Exercise setup</div>
              <div className="mt-1 text-sm text-slate-500">Save lifts once.</div>
            </summary>
            <div className="border-t border-slate-200 px-4 py-4">
              <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); createExercise.mutate() }}>
                <LabelledInput label="Exercise name" value={exerciseDraft.name} onChange={(value) => setExerciseDraft((current) => ({ ...current, name: value }))} error={exerciseDraftError || undefined} />
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <LabelledInput label="Rep min" type="number" value={exerciseDraft.rep_target_min} onChange={(value) => setExerciseDraft((current) => ({ ...current, rep_target_min: value }))} />
                  <LabelledInput label="Rep max" type="number" value={exerciseDraft.rep_target_max} onChange={(value) => setExerciseDraft((current) => ({ ...current, rep_target_max: value }))} />
                  <LabelledInput label={`Load jump (${weightUnitLabel})`} type="number" step="0.5" value={exerciseDraft.load_increment} onChange={(value) => setExerciseDraft((current) => ({ ...current, load_increment: value }))} />
                </div>
                <ActionButton type="submit" className="sm:w-auto" disabled={Boolean(exerciseDraftError) || createExercise.isPending}>{createExercise.isPending ? 'Saving...' : 'Save exercise'}</ActionButton>
              </form>

              <div className="mt-4">
                <LabelledInput label="Search saved exercises" value={exerciseSearch} onChange={setExerciseSearch} placeholder="Bench, row, squat" />
              </div>
              <div className="mt-4 space-y-2">
                {quickExercises.map((exercise) => (
                  <button
                    key={exercise.id}
                    type="button"
                    className="w-full rounded-2xl bg-slate-50 px-4 py-3 text-left text-sm transition hover:bg-amber-50"
                    onClick={() => setSelectedExerciseId(exercise.id)}
                  >
                    <div className="font-semibold text-slate-950">{exercise.name}</div>
                    <div className="mt-1 text-slate-500">{exercise.rep_target_min}-{exercise.rep_target_max} reps, +{formatMass(exercise.load_increment, weightUnit)}</div>
                  </button>
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
