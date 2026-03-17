import { queryClient } from './query-client'

async function invalidate(keys: readonly (readonly unknown[])[]) {
  await Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })))
}

export async function invalidateCalendarQueries() {
  await invalidate([
    ['calendar-month'],
    ['calendar-day'],
  ])
}

export async function invalidateMealQueries() {
  await invalidate([
    ['meals'],
    ['dashboard'],
    ['insights'],
    ['insights-summary'],
    ['assistant-feed'],
    ['assistant-brief'],
    ['calendar-month'],
    ['calendar-day'],
  ])
}

export async function invalidateWorkoutQueries() {
  await invalidate([
    ['workout-sessions'],
    ['exercise-progression'],
    ['dashboard'],
    ['insights'],
    ['insights-summary'],
    ['assistant-feed'],
    ['assistant-brief'],
    ['calendar-month'],
    ['calendar-day'],
  ])
}

export async function invalidateWeightQueries() {
  await invalidate([
    ['weight-entries'],
    ['weight-trends'],
    ['dashboard'],
    ['insights'],
    ['insights-summary'],
    ['assistant-feed'],
    ['assistant-brief'],
    ['calendar-month'],
    ['calendar-day'],
  ])
}

export async function invalidateCheckInQueries() {
  await invalidate([
    ['assistant-feed'],
    ['assistant-brief'],
    ['dashboard'],
    ['insights'],
    ['insights-summary'],
    ['calendar-month'],
    ['calendar-day'],
  ])
}
