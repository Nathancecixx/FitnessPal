import type { Routine, WorkoutSession, WorkoutTemplate } from '../../lib/api'
import { createDateTimeInputValue, toIsoFromDateTimeInput, toLocalDateTimeInputValue } from '../../lib/date'
import { convertMassToKg, formatMassInput, type WeightUnit } from '../../lib/weight-units'

export type SessionBlockDraft = {
  exercise_id: string
  target_sets: string
  reps: string
  load_kg: string
  rir: string
}

export type WorkoutSessionDraft = {
  routine_id: string
  notes: string
  started_at: string
  ended_at: string
  perceived_energy: string
  bodyweight_kg: string
  blocks: SessionBlockDraft[]
}

export function createSessionBlockDraft(exerciseId = ''): SessionBlockDraft {
  return {
    exercise_id: exerciseId,
    target_sets: '3',
    reps: '8',
    load_kg: '0',
    rir: '2',
  }
}

export function createWorkoutSessionDraft(dateKey: string, todayDateKey: string, fallbackTime = '18:00'): WorkoutSessionDraft {
  return {
    routine_id: '',
    notes: '',
    started_at: createDateTimeInputValue(dateKey, fallbackTime, todayDateKey),
    ended_at: '',
    perceived_energy: '',
    bodyweight_kg: '',
    blocks: [createSessionBlockDraft()],
  }
}

export function buildBlocksFromRoutine(routine: Routine, dayLabel: string): SessionBlockDraft[] {
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

export function buildBlocksFromTemplate(template: WorkoutTemplate): SessionBlockDraft[] {
  return template.items.map((item) => ({
    exercise_id: item.exercise_id,
    target_sets: String(item.target_sets),
    reps: String(item.target_reps_max),
    load_kg: '0',
    rir: item.target_rir != null ? String(item.target_rir) : '2',
  }))
}

export function buildBlocksFromSession(session: WorkoutSession, weightUnit: WeightUnit): SessionBlockDraft[] {
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
    if (!current) {
      continue
    }

    current.target_sets = String(Number(current.target_sets) + 1)
    current.reps = String(entry.reps)
    current.load_kg = formatMassInput(entry.load_kg, weightUnit)
    current.rir = String(entry.rir ?? 2)
  }

  return order.map((exerciseId) => grouped.get(exerciseId) ?? createSessionBlockDraft(exerciseId))
}

export function toWorkoutSessionDraft(session: WorkoutSession, weightUnit: WeightUnit): WorkoutSessionDraft {
  const blocks = buildBlocksFromSession(session, weightUnit)
  return {
    routine_id: session.routine_id ?? '',
    notes: session.notes ?? '',
    started_at: toLocalDateTimeInputValue(session.started_at),
    ended_at: toLocalDateTimeInputValue(session.ended_at),
    perceived_energy: session.perceived_energy != null ? String(session.perceived_energy) : '',
    bodyweight_kg: session.bodyweight_kg != null ? formatMassInput(session.bodyweight_kg, weightUnit) : '',
    blocks: blocks.length ? blocks : [createSessionBlockDraft()],
  }
}

export function hasValidSessionBlock(draft: WorkoutSessionDraft) {
  return draft.blocks.some((block) =>
    Boolean(block.exercise_id) && Number(block.target_sets) > 0 && Number(block.reps) > 0 && Number(block.load_kg) >= 0)
}

export function expandBlocksToSets(blocks: SessionBlockDraft[], weightUnit: WeightUnit) {
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

export function buildWorkoutSessionPayload(draft: WorkoutSessionDraft, weightUnit: WeightUnit) {
  return {
    routine_id: draft.routine_id || undefined,
    started_at: toIsoFromDateTimeInput(draft.started_at),
    ended_at: toIsoFromDateTimeInput(draft.ended_at) ?? null,
    notes: draft.notes || undefined,
    perceived_energy: draft.perceived_energy ? Number(draft.perceived_energy) : undefined,
    bodyweight_kg: draft.bodyweight_kg ? convertMassToKg(Number(draft.bodyweight_kg), weightUnit) : undefined,
    sets: expandBlocksToSets(draft.blocks, weightUnit),
  }
}
