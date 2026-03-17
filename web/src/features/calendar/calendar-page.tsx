import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'

import { ActionButton, ConfirmSheet, type ConfirmSheetRequest, EmptyState, ErrorState, LabelledInput, LabelledSelect, LabelledTextArea, LoadingState, PageIntro, Panel } from '../../components/ui'
import type { CalendarDayDetail, CalendarDaySummary, CalendarMonthResponse, MealEntry, WeightEntry, WorkoutSession } from '../../lib/api'
import { api } from '../../lib/api'
import { addDays, addMonthsClamped, formatLongDateLabel, formatMonthLabel, formatWeekdayLabel, getDayOfMonth, getTodayDateKey } from '../../lib/date'
import { getSyncState, subscribeSyncState, type SyncState } from '../../lib/offline'
import { invalidateCheckInQueries, invalidateMealQueries, invalidateWeightQueries, invalidateWorkoutQueries } from '../../lib/query-invalidations'
import { queryClient } from '../../lib/query-client'
import { useUserPreferencesQuery, useWeightUnit } from '../../lib/user-preferences'
import { formatMass, getWeightUnitLabel } from '../../lib/weight-units'
import { buildCheckInPayload, createCheckInDraft, getCheckInDraftError, toCheckInDraft, type CheckInDraft } from '../day-editor/check-in-editor'
import { buildMealPayload, createEmptyMealItem, createMealDraft, isMealDraftInvalid, toMealDraft, type MealDraft } from '../day-editor/meal-editor'
import { buildWeightEntryPayload, createWeightEntryDraft, getWeightDraftErrors, toWeightEntryDraft, type WeightEntryDraft } from '../day-editor/weight-editor'
import { buildWorkoutSessionPayload, createSessionBlockDraft, createWorkoutSessionDraft, hasValidSessionBlock, toWorkoutSessionDraft, type WorkoutSessionDraft } from '../day-editor/workout-editor'

function readSelectedDate(pathname: string) {
  const match = /^\/calendar\/(\d{4}-\d{2}-\d{2})$/.exec(pathname)
  return match?.[1] ?? null
}

function formatTimeLabel(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function sortByDateValue<T extends { logged_at?: string; started_at?: string }>(items: T[]) {
  return [...items].sort((left, right) => {
    const leftValue = new Date(left.logged_at ?? left.started_at ?? '').getTime()
    const rightValue = new Date(right.logged_at ?? right.started_at ?? '').getTime()
    return leftValue - rightValue
  })
}

function MetricBadge(props: { label: string; value: string; tone?: 'default' | 'accent' }) {
  return (
    <div className={`rounded-full px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] ${props.tone === 'accent' ? 'bg-lime text-slate-950' : 'bg-slate-100 text-slate-700'}`}>
      {props.label}: {props.value}
    </div>
  )
}

function CalendarDayCell(props: { cell: CalendarDaySummary; selectedDate: string; onSelect: (date: string) => void; weightUnitLabel: string }) {
  const selected = props.cell.date === props.selectedDate

  return (
    <button
      type="button"
      onClick={() => props.onSelect(props.cell.date)}
      className={`min-h-[124px] rounded-[22px] border p-3 text-left transition ${
        selected
          ? 'border-slate-950 bg-slate-950 text-canvas shadow-halo'
          : props.cell.is_in_month
            ? 'border-slate-200 bg-white text-slate-900 hover:border-amber-300 hover:bg-amber-50'
            : 'border-slate-200 bg-slate-50 text-slate-500 hover:border-slate-300'
      } ${props.cell.is_future ? 'opacity-70' : ''}`}
      aria-pressed={selected}
    >
      <div className="flex items-start justify-between gap-2">
        <div className={`text-sm font-semibold ${selected ? 'text-canvas' : 'text-inherit'}`}>
          {getDayOfMonth(props.cell.date)}
        </div>
        <div className="flex items-center gap-2">
          {props.cell.has_check_in ? <span className={`h-2.5 w-2.5 rounded-full ${selected ? 'bg-lime' : 'bg-emerald-500'}`} aria-label="Check-in saved" /> : null}
          {props.cell.is_today ? (
            <span className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${selected ? 'bg-white/10 text-white' : 'bg-slate-950 text-canvas'}`}>
              Today
            </span>
          ) : null}
        </div>
      </div>
      <div className="mt-3 space-y-2 text-xs leading-5">
        <div>{props.cell.total_calories ? `${props.cell.total_calories} kcal` : 'No meals'}</div>
        <div>{props.cell.workout_count ? `${props.cell.workout_count} workout${props.cell.workout_count === 1 ? '' : 's'}` : 'No workouts'}</div>
        <div>{props.cell.latest_weight_kg != null ? `${props.cell.latest_weight_kg.toFixed(1)} ${props.weightUnitLabel}` : 'No weight'}</div>
      </div>
    </button>
  )
}

export function CalendarRedirectPage() {
  const navigate = useNavigate()
  const preferencesQuery = useUserPreferencesQuery()
  const timezone = preferencesQuery.data?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const todayDateKey = getTodayDateKey(timezone)

  useEffect(() => {
    void navigate({ to: '/calendar/$date', params: { date: todayDateKey }, replace: true })
  }, [navigate, todayDateKey])

  return <LoadingState title="Opening calendar" body="Loading your current day." />
}

export function CalendarPage() {
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const selectedDate = readSelectedDate(pathname)
  const preferencesQuery = useUserPreferencesQuery()
  const weightUnit = useWeightUnit()
  const weightUnitLabel = getWeightUnitLabel(weightUnit)
  const timezone = preferencesQuery.data?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const todayDateKey = getTodayDateKey(timezone)
  const monthKey = selectedDate ? `${selectedDate.slice(0, 7)}-01` : `${todayDateKey.slice(0, 7)}-01`
  const [syncState, setSyncState] = useState<SyncState>(getSyncState)
  const [editingMealId, setEditingMealId] = useState<string | null>(null)
  const [mealDraft, setMealDraft] = useState<MealDraft>(() => createMealDraft(selectedDate ?? todayDateKey, todayDateKey))
  const [editingWorkoutId, setEditingWorkoutId] = useState<string | null>(null)
  const [workoutDraft, setWorkoutDraft] = useState<WorkoutSessionDraft>(() => createWorkoutSessionDraft(selectedDate ?? todayDateKey, todayDateKey))
  const [editingWeightId, setEditingWeightId] = useState<string | null>(null)
  const [weightDraft, setWeightDraft] = useState<WeightEntryDraft>(() => createWeightEntryDraft(selectedDate ?? todayDateKey, todayDateKey))
  const [checkInDraft, setCheckInDraft] = useState<CheckInDraft>(createCheckInDraft())
  const [confirmRequest, setConfirmRequest] = useState<ConfirmSheetRequest | null>(null)

  useEffect(() => subscribeSyncState(setSyncState), [])

  useEffect(() => {
    if (!selectedDate) {
      void navigate({ to: '/calendar/$date', params: { date: todayDateKey }, replace: true })
    }
  }, [navigate, selectedDate, todayDateKey])

  useEffect(() => {
    if (!selectedDate) {
      return
    }
    setEditingMealId(null)
    setMealDraft(createMealDraft(selectedDate, todayDateKey))
    setEditingWorkoutId(null)
    setWorkoutDraft(createWorkoutSessionDraft(selectedDate, todayDateKey))
    setEditingWeightId(null)
    setWeightDraft(createWeightEntryDraft(selectedDate, todayDateKey))
    setConfirmRequest(null)
  }, [selectedDate, todayDateKey])

  const monthQuery = useQuery({
    queryKey: ['calendar-month', monthKey],
    queryFn: () => api.getCalendarMonth(selectedDate ?? todayDateKey),
    enabled: Boolean(selectedDate),
  })
  const dayQuery = useQuery({
    queryKey: ['calendar-day', selectedDate],
    queryFn: () => api.getCalendarDay(selectedDate ?? todayDateKey),
    enabled: Boolean(selectedDate),
  })
  const exercisesQuery = useQuery({ queryKey: ['exercises'], queryFn: api.listExercises })

  useEffect(() => {
    setCheckInDraft(toCheckInDraft(dayQuery.data?.check_in))
  }, [dayQuery.data?.check_in?.id, dayQuery.data?.check_in?.updated_at, selectedDate])

  const exerciseOptions = useMemo(() => [
    { label: 'Select exercise', value: '' },
    ...(exercisesQuery.data?.items ?? []).map((exercise) => ({ label: exercise.name, value: exercise.id })),
  ], [exercisesQuery.data?.items])
  const exerciseNameById = useMemo(
    () => Object.fromEntries((exercisesQuery.data?.items ?? []).map((exercise) => [exercise.id, exercise.name])),
    [exercisesQuery.data?.items],
  )
  const weekdayLabels = useMemo(() => {
    const gridStart = monthQuery.data?.grid_start ?? monthKey
    return Array.from({ length: 7 }, (_, index) => formatWeekdayLabel(addDays(gridStart, index)))
  }, [monthKey, monthQuery.data?.grid_start])
  const isOnline = syncState.isOnline
  const dayData = dayQuery.data
  const isEditableDay = Boolean(dayData?.is_editable)
  const selectedDateLabel = formatLongDateLabel(selectedDate ?? todayDateKey)
  const mealDraftInvalid = isMealDraftInvalid(mealDraft)
  const weightErrors = getWeightDraftErrors(weightDraft)
  const weightDraftInvalid = Boolean(weightErrors.weight || weightErrors.bodyFat || weightErrors.waist)
  const workoutDraftInvalid = !hasValidSessionBlock(workoutDraft)
  const checkInError = getCheckInDraftError(checkInDraft)

  function openDate(date: string) {
    void navigate({ to: '/calendar/$date', params: { date } })
  }

  function updateDayCache(updater: (current: CalendarDayDetail) => CalendarDayDetail) {
    if (!selectedDate) {
      return
    }
    queryClient.setQueryData<CalendarDayDetail | undefined>(['calendar-day', selectedDate], (current) => current ? updater(current) : current)
  }

  function updateMonthCell(updater: (current: CalendarDaySummary) => CalendarDaySummary) {
    queryClient.setQueryData<CalendarMonthResponse | undefined>(['calendar-month', monthKey], (current) => {
      if (!current || !selectedDate) {
        return current
      }
      return {
        ...current,
        weeks: current.weeks.map((week) => week.map((cell) => cell.date === selectedDate ? updater(cell) : cell)),
      }
    })
  }

  const saveMeal = useMutation({
    mutationFn: async () => {
      const payload = buildMealPayload(mealDraft)
      return editingMealId ? api.updateMeal(editingMealId, payload) : api.createMeal(payload)
    },
    onSuccess: async (result) => {
      const createdMeal = result as MealEntry & { sync_status?: string }
      if (!editingMealId && createdMeal.sync_status === 'queued') {
        updateDayCache((current) => ({
          ...current,
          meals: sortByDateValue([...current.meals, createdMeal]),
          summary: {
            ...current.summary,
            meal_count: current.summary.meal_count + 1,
            total_calories: current.summary.total_calories + Math.round(createdMeal.totals.calories),
          },
        }))
        updateMonthCell((current) => ({
          ...current,
          meal_count: current.meal_count + 1,
          total_calories: current.total_calories + Math.round(createdMeal.totals.calories),
        }))
      }
      setEditingMealId(null)
      setMealDraft(createMealDraft(selectedDate ?? todayDateKey, todayDateKey))
      await invalidateMealQueries()
    },
  })

  const deleteMeal = useMutation({
    mutationFn: (mealId: string) => api.deleteMeal(mealId),
    onSuccess: async () => {
      setEditingMealId(null)
      setMealDraft(createMealDraft(selectedDate ?? todayDateKey, todayDateKey))
      await invalidateMealQueries()
    },
  })

  const saveWorkout = useMutation({
    mutationFn: async () => {
      const payload = buildWorkoutSessionPayload(workoutDraft, weightUnit)
      return editingWorkoutId ? api.updateWorkoutSession(editingWorkoutId, payload) : api.createWorkoutSession(payload)
    },
    onSuccess: async (result) => {
      const createdWorkout = result as WorkoutSession & { sync_status?: string }
      if (!editingWorkoutId && createdWorkout.sync_status === 'queued') {
        updateDayCache((current) => ({
          ...current,
          workouts: sortByDateValue([...current.workouts, createdWorkout]),
          summary: {
            ...current.summary,
            workout_count: current.summary.workout_count + 1,
          },
        }))
        updateMonthCell((current) => ({
          ...current,
          workout_count: current.workout_count + 1,
        }))
      }
      setEditingWorkoutId(null)
      setWorkoutDraft(createWorkoutSessionDraft(selectedDate ?? todayDateKey, todayDateKey))
      await invalidateWorkoutQueries()
    },
  })

  const deleteWorkout = useMutation({
    mutationFn: (sessionId: string) => api.deleteWorkoutSession(sessionId),
    onSuccess: async () => {
      setEditingWorkoutId(null)
      setWorkoutDraft(createWorkoutSessionDraft(selectedDate ?? todayDateKey, todayDateKey))
      await invalidateWorkoutQueries()
    },
  })

  const saveWeight = useMutation({
    mutationFn: async () => {
      const payload = buildWeightEntryPayload(weightDraft, weightUnit)
      return editingWeightId ? api.updateWeightEntry(editingWeightId, payload) : api.createWeightEntry(payload)
    },
    onSuccess: async (result) => {
      const createdWeight = result as WeightEntry & { sync_status?: string }
      if (!editingWeightId && createdWeight.sync_status === 'queued') {
        updateDayCache((current) => ({
          ...current,
          weight_entries: sortByDateValue([...current.weight_entries, createdWeight]),
          summary: {
            ...current.summary,
            latest_weight_kg: createdWeight.weight_kg,
          },
        }))
        updateMonthCell((current) => ({
          ...current,
          latest_weight_kg: createdWeight.weight_kg,
        }))
      }
      setEditingWeightId(null)
      setWeightDraft(createWeightEntryDraft(selectedDate ?? todayDateKey, todayDateKey))
      await invalidateWeightQueries()
    },
  })

  const deleteWeight = useMutation({
    mutationFn: (entryId: string) => api.deleteWeightEntry(entryId),
    onSuccess: async () => {
      setEditingWeightId(null)
      setWeightDraft(createWeightEntryDraft(selectedDate ?? todayDateKey, todayDateKey))
      await invalidateWeightQueries()
    },
  })

  const saveCheckIn = useMutation({
    mutationFn: () => api.updateCoachCheckIn(buildCheckInPayload(checkInDraft, selectedDate ?? undefined)),
    onSuccess: async (result) => {
      updateDayCache((current) => ({
        ...current,
        check_in: result.check_in ?? null,
        summary: {
          ...current.summary,
          has_check_in: Boolean(result.check_in),
        },
      }))
      updateMonthCell((current) => ({
        ...current,
        has_check_in: Boolean(result.check_in),
      }))
      await invalidateCheckInQueries()
    },
  })

  if (!selectedDate) {
    return <LoadingState title="Opening calendar" body="Loading your day." />
  }

  return (
    <div className="space-y-4">
      <PageIntro
        eyebrow="Calendar"
        title="Own every day"
        description="See the month at a glance, then edit one day at a time without leaving the calendar."
        actions={(
          <>
            <ActionButton tone="secondary" onClick={() => openDate(addMonthsClamped(selectedDate, -1))} className="w-full sm:w-auto">
              Previous month
            </ActionButton>
            <ActionButton tone="secondary" onClick={() => openDate(todayDateKey)} className="w-full sm:w-auto">
              Today
            </ActionButton>
            <ActionButton tone="secondary" onClick={() => openDate(addMonthsClamped(selectedDate, 1))} className="w-full sm:w-auto">
              Next month
            </ActionButton>
          </>
        )}
      />

      {!isOnline ? (
        <div className="app-status app-status-warning rounded-[24px] px-4 py-4 text-sm leading-6">
          Offline mode: new meals, workouts, and weight entries can still queue from this page. Editing or deleting existing entries and saving check-ins needs a connection.
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.95fr)]">
        <Panel
          title={formatMonthLabel(monthQuery.data?.anchor_date ?? selectedDate)}
          subtitle={`TZ: ${monthQuery.data?.timezone ?? timezone}`}
        >
          {monthQuery.isLoading ? (
            <LoadingState title="Loading month" body="Building your calendar." />
          ) : monthQuery.isError ? (
            <ErrorState title="Could not load calendar" body={monthQuery.error.message} action={<ActionButton onClick={() => monthQuery.refetch()} className="w-auto">Retry</ActionButton>} />
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-7 gap-2">
                {weekdayLabels.map((label) => (
                  <div key={label} className="px-2 text-center text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                    {label}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-2">
                {monthQuery.data?.weeks.flat().map((cell) => (
                  <CalendarDayCell key={cell.date} cell={cell} selectedDate={selectedDate} onSelect={openDate} weightUnitLabel={weightUnitLabel} />
                ))}
              </div>
            </div>
          )}
        </Panel>

        <div className="space-y-4">
          <Panel
            title={selectedDateLabel}
            subtitle={dayData ? `${dayData.timezone} ${dayData.is_today ? '| Today' : dayData.is_future ? '| Future (read only)' : '| History'}` : 'Loading selected day'}
          >
            {dayQuery.isLoading ? (
              <LoadingState title="Loading day" body="Gathering meals, workouts, weight, and check-ins." />
            ) : dayQuery.isError ? (
              <ErrorState title="Could not load day" body={dayQuery.error.message} action={<ActionButton onClick={() => dayQuery.refetch()} className="w-auto">Retry</ActionButton>} />
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <MetricBadge label="Calories" value={`${dayData?.summary.total_calories ?? 0}`} tone="accent" />
                  <MetricBadge label="Meals" value={`${dayData?.summary.meal_count ?? 0}`} />
                  <MetricBadge label="Workouts" value={`${dayData?.summary.workout_count ?? 0}`} />
                  <MetricBadge label="Weight" value={dayData?.summary.latest_weight_kg != null ? formatMass(dayData.summary.latest_weight_kg, weightUnit) : 'None'} />
                </div>
                {!isEditableDay ? (
                  <div className="app-status app-status-info rounded-[22px] px-4 py-3 text-sm">
                    Future dates are visible here, but editing stays disabled in v1.
                  </div>
                ) : null}
              </div>
            )}
          </Panel>
          <Panel
            title="Meals"
            subtitle="Add, edit, and remove food logs for this day."
            action={(
              <ActionButton tone="secondary" onClick={() => { setEditingMealId(null); setMealDraft(createMealDraft(selectedDate, todayDateKey)) }} className="w-auto" disabled={!isEditableDay}>
                Add meal
              </ActionButton>
            )}
          >
            {dayData?.meals.length ? (
              <div className="space-y-3">
                {dayData.meals.map((meal) => (
                  <div key={meal.id} className="rounded-[22px] border border-slate-200 bg-white p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-slate-950">{meal.meal_type}</div>
                        <div className="mt-1 text-sm text-slate-500">{formatTimeLabel(meal.logged_at)} | {Math.round(meal.totals.calories)} kcal</div>
                        {meal.notes ? <div className="mt-2 text-sm text-slate-600">{meal.notes}</div> : null}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <ActionButton tone="secondary" onClick={() => { setEditingMealId(meal.id); setMealDraft(toMealDraft(meal)) }} className="w-auto" disabled={!isOnline || !isEditableDay}>
                          Edit
                        </ActionButton>
                        <ActionButton
                          tone="secondary"
                          onClick={() => setConfirmRequest({
                            title: 'Delete this meal?',
                            body: `Type ${meal.meal_type} to confirm deleting this meal.`,
                            confirmLabel: 'Delete meal',
                            confirmationValue: meal.meal_type,
                            confirmationHint: `Type ${meal.meal_type} to confirm`,
                            isPending: deleteMeal.isPending,
                            onConfirm: () => deleteMeal.mutate(meal.id),
                          })}
                          className="w-auto"
                          disabled={!isOnline || !isEditableDay}
                        >
                          Delete
                        </ActionButton>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="No meals on this day" body="Use the editor below to add the first meal." />
            )}

            <div className="mt-4 rounded-[22px] bg-slate-50 p-4 ring-1 ring-slate-200">
              <div className="mb-3 font-semibold text-slate-950">{editingMealId ? 'Edit meal' : 'New meal'}</div>
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <LabelledSelect
                    label="Meal type"
                    value={mealDraft.meal_type}
                    onChange={(value) => setMealDraft((current) => ({ ...current, meal_type: value }))}
                    options={[
                      { label: 'Breakfast', value: 'breakfast' },
                      { label: 'Lunch', value: 'lunch' },
                      { label: 'Dinner', value: 'dinner' },
                      { label: 'Snack', value: 'snack' },
                      { label: 'Meal', value: 'meal' },
                    ]}
                    disabled={!isEditableDay}
                  />
                  <LabelledInput label="Logged at" type="datetime-local" value={mealDraft.logged_at} onChange={(value) => setMealDraft((current) => ({ ...current, logged_at: value }))} disabled={!isEditableDay} />
                </div>
                <LabelledTextArea label="Notes" value={mealDraft.notes} onChange={(value) => setMealDraft((current) => ({ ...current, notes: value }))} rows={2} disabled={!isEditableDay} />
                {mealDraft.items.map((item, index) => (
                  <div key={`${editingMealId ?? 'new'}-${index}`} className="rounded-[18px] bg-white p-3">
                    <div className="grid gap-3">
                      <LabelledInput
                        label="Label"
                        value={item.label}
                        onChange={(value) => setMealDraft((current) => ({
                          ...current,
                          items: current.items.map((entry, itemIndex) => itemIndex === index ? { ...entry, label: value } : entry),
                        }))}
                        error={!item.label.trim() ? 'Item label is required.' : undefined}
                        disabled={!isEditableDay}
                      />
                      <div className="grid gap-3 sm:grid-cols-2">
                        <LabelledInput label="Grams" type="number" value={item.grams} onChange={(value) => setMealDraft((current) => ({ ...current, items: current.items.map((entry, itemIndex) => itemIndex === index ? { ...entry, grams: value } : entry) }))} disabled={!isEditableDay} />
                        <LabelledInput label="Calories" type="number" value={item.calories} onChange={(value) => setMealDraft((current) => ({ ...current, items: current.items.map((entry, itemIndex) => itemIndex === index ? { ...entry, calories: value } : entry) }))} disabled={!isEditableDay} />
                        <LabelledInput label="Protein" type="number" value={item.protein_g} onChange={(value) => setMealDraft((current) => ({ ...current, items: current.items.map((entry, itemIndex) => itemIndex === index ? { ...entry, protein_g: value } : entry) }))} disabled={!isEditableDay} />
                        <LabelledInput label="Carbs" type="number" value={item.carbs_g} onChange={(value) => setMealDraft((current) => ({ ...current, items: current.items.map((entry, itemIndex) => itemIndex === index ? { ...entry, carbs_g: value } : entry) }))} disabled={!isEditableDay} />
                        <LabelledInput label="Fat" type="number" value={item.fat_g} onChange={(value) => setMealDraft((current) => ({ ...current, items: current.items.map((entry, itemIndex) => itemIndex === index ? { ...entry, fat_g: value } : entry) }))} disabled={!isEditableDay} />
                        <LabelledInput label="Fiber" type="number" value={item.fiber_g} onChange={(value) => setMealDraft((current) => ({ ...current, items: current.items.map((entry, itemIndex) => itemIndex === index ? { ...entry, fiber_g: value } : entry) }))} disabled={!isEditableDay} />
                      </div>
                    </div>
                  </div>
                ))}
                <div className="flex flex-wrap gap-2">
                  <ActionButton tone="secondary" onClick={() => setMealDraft((current) => ({ ...current, items: [...current.items, createEmptyMealItem()] }))} className="w-auto" disabled={!isEditableDay}>
                    Add item
                  </ActionButton>
                  <ActionButton onClick={() => saveMeal.mutate()} className="w-auto" disabled={mealDraftInvalid || saveMeal.isPending || !isEditableDay}>
                    {saveMeal.isPending ? 'Saving...' : editingMealId ? 'Save meal' : 'Create meal'}
                  </ActionButton>
                  {editingMealId ? (
                    <ActionButton tone="secondary" onClick={() => { setEditingMealId(null); setMealDraft(createMealDraft(selectedDate, todayDateKey)) }} className="w-auto">
                      Cancel
                    </ActionButton>
                  ) : null}
                  <Link to="/nutrition" className="inline-flex min-h-[48px] items-center justify-center rounded-full bg-white px-5 py-3 text-sm font-semibold text-slate-900 ring-1 ring-slate-200">
                    Advanced nutrition tools
                  </Link>
                </div>
                {saveMeal.isError ? <div className="app-status app-status-danger rounded-[22px] px-4 py-3 text-sm">{saveMeal.error.message}</div> : null}
              </div>
            </div>
          </Panel>

          <Panel
            title="Workouts"
            subtitle="Keep training sessions tied to the right day."
            action={(
              <ActionButton tone="secondary" onClick={() => { setEditingWorkoutId(null); setWorkoutDraft(createWorkoutSessionDraft(selectedDate, todayDateKey)) }} className="w-auto" disabled={!isEditableDay}>
                Add workout
              </ActionButton>
            )}
          >
            {dayData?.workouts.length ? (
              <div className="space-y-3">
                {dayData.workouts.map((session) => (
                  <div key={session.id} className="rounded-[22px] border border-slate-200 bg-white p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-slate-950">{session.notes || 'Workout session'}</div>
                        <div className="mt-1 text-sm text-slate-500">{formatTimeLabel(session.started_at)} | {session.total_sets} sets</div>
                        <div className="mt-2 text-sm text-slate-600">
                          {session.sets.slice(0, 3).map((set) => `${exerciseNameById[set.exercise_id] ?? 'Exercise'} ${set.reps}x${set.load_kg}`).join(' / ') || 'No set detail'}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <ActionButton tone="secondary" onClick={() => { setEditingWorkoutId(session.id); setWorkoutDraft(toWorkoutSessionDraft(session, weightUnit)) }} className="w-auto" disabled={!isOnline || !isEditableDay}>
                          Edit
                        </ActionButton>
                        <ActionButton
                          tone="secondary"
                          onClick={() => setConfirmRequest({
                            title: 'Delete this workout?',
                            body: `Type ${session.notes || 'Workout session'} to confirm deleting this session.`,
                            confirmLabel: 'Delete workout',
                            confirmationValue: session.notes || 'Workout session',
                            confirmationHint: `Type ${session.notes || 'Workout session'} to confirm`,
                            isPending: deleteWorkout.isPending,
                            onConfirm: () => deleteWorkout.mutate(session.id),
                          })}
                          className="w-auto"
                          disabled={!isOnline || !isEditableDay}
                        >
                          Delete
                        </ActionButton>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="No workouts on this day" body="Use the session editor below to log one." />
            )}

            <div className="mt-4 rounded-[22px] bg-slate-50 p-4 ring-1 ring-slate-200">
              <div className="mb-3 font-semibold text-slate-950">{editingWorkoutId ? 'Edit workout' : 'New workout'}</div>
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <LabelledInput label="Started at" type="datetime-local" value={workoutDraft.started_at} onChange={(value) => setWorkoutDraft((current) => ({ ...current, started_at: value }))} disabled={!isEditableDay} />
                  <LabelledInput label="Ended at" type="datetime-local" value={workoutDraft.ended_at} onChange={(value) => setWorkoutDraft((current) => ({ ...current, ended_at: value }))} disabled={!isEditableDay} />
                  <LabelledInput label="Perceived energy (1-10)" type="number" value={workoutDraft.perceived_energy} onChange={(value) => setWorkoutDraft((current) => ({ ...current, perceived_energy: value }))} disabled={!isEditableDay} />
                  <LabelledInput label={`Bodyweight (${weightUnitLabel})`} type="number" value={workoutDraft.bodyweight_kg} onChange={(value) => setWorkoutDraft((current) => ({ ...current, bodyweight_kg: value }))} disabled={!isEditableDay} />
                </div>
                <LabelledTextArea label="Notes" value={workoutDraft.notes} onChange={(value) => setWorkoutDraft((current) => ({ ...current, notes: value }))} rows={2} disabled={!isEditableDay} />
                {workoutDraft.blocks.map((block, index) => (
                  <div key={`${editingWorkoutId ?? 'new-workout'}-${index}`} className="rounded-[18px] bg-white p-3">
                    <div className="grid gap-3">
                      <LabelledSelect
                        label="Exercise"
                        value={block.exercise_id}
                        onChange={(value) => setWorkoutDraft((current) => ({
                          ...current,
                          blocks: current.blocks.map((entry, blockIndex) => blockIndex === index ? { ...entry, exercise_id: value } : entry),
                        }))}
                        options={exerciseOptions}
                        error={!block.exercise_id ? 'Choose an exercise.' : undefined}
                        disabled={!isEditableDay}
                      />
                      <div className="grid gap-3 sm:grid-cols-2">
                        <LabelledInput label="Sets" type="number" value={block.target_sets} onChange={(value) => setWorkoutDraft((current) => ({ ...current, blocks: current.blocks.map((entry, blockIndex) => blockIndex === index ? { ...entry, target_sets: value } : entry) }))} disabled={!isEditableDay} />
                        <LabelledInput label="Reps" type="number" value={block.reps} onChange={(value) => setWorkoutDraft((current) => ({ ...current, blocks: current.blocks.map((entry, blockIndex) => blockIndex === index ? { ...entry, reps: value } : entry) }))} disabled={!isEditableDay} />
                        <LabelledInput label={`Load (${weightUnitLabel})`} type="number" value={block.load_kg} onChange={(value) => setWorkoutDraft((current) => ({ ...current, blocks: current.blocks.map((entry, blockIndex) => blockIndex === index ? { ...entry, load_kg: value } : entry) }))} disabled={!isEditableDay} />
                        <LabelledInput label="RIR" type="number" value={block.rir} onChange={(value) => setWorkoutDraft((current) => ({ ...current, blocks: current.blocks.map((entry, blockIndex) => blockIndex === index ? { ...entry, rir: value } : entry) }))} disabled={!isEditableDay} />
                      </div>
                    </div>
                  </div>
                ))}
                <div className="flex flex-wrap gap-2">
                  <ActionButton tone="secondary" onClick={() => setWorkoutDraft((current) => ({ ...current, blocks: [...current.blocks, createSessionBlockDraft()] }))} className="w-auto" disabled={!isEditableDay}>
                    Add exercise block
                  </ActionButton>
                  <ActionButton onClick={() => saveWorkout.mutate()} className="w-auto" disabled={workoutDraftInvalid || saveWorkout.isPending || !isEditableDay || exerciseOptions.length === 1}>
                    {saveWorkout.isPending ? 'Saving...' : editingWorkoutId ? 'Save workout' : 'Create workout'}
                  </ActionButton>
                  {editingWorkoutId ? (
                    <ActionButton tone="secondary" onClick={() => { setEditingWorkoutId(null); setWorkoutDraft(createWorkoutSessionDraft(selectedDate, todayDateKey)) }} className="w-auto">
                      Cancel
                    </ActionButton>
                  ) : null}
                  <Link to="/training" className="inline-flex min-h-[48px] items-center justify-center rounded-full bg-white px-5 py-3 text-sm font-semibold text-slate-900 ring-1 ring-slate-200">
                    Templates and routines
                  </Link>
                </div>
                {exerciseOptions.length === 1 ? (
                  <div className="app-status app-status-warning rounded-[22px] px-4 py-3 text-sm">
                    Add exercises on the Training page before logging a workout here.
                  </div>
                ) : null}
                {saveWorkout.isError ? <div className="app-status app-status-danger rounded-[22px] px-4 py-3 text-sm">{saveWorkout.error.message}</div> : null}
              </div>
            </div>
          </Panel>

          <Panel
            title="Weight entries"
            subtitle="Keep weigh-ins and optional body metrics on the correct day."
            action={(
              <ActionButton tone="secondary" onClick={() => { setEditingWeightId(null); setWeightDraft(createWeightEntryDraft(selectedDate, todayDateKey)) }} className="w-auto" disabled={!isEditableDay}>
                Add weight
              </ActionButton>
            )}
          >
            {dayData?.weight_entries.length ? (
              <div className="space-y-3">
                {dayData.weight_entries.map((entry) => (
                  <div key={entry.id} className="rounded-[22px] border border-slate-200 bg-white p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-slate-950">{formatMass(entry.weight_kg, weightUnit)}</div>
                        <div className="mt-1 text-sm text-slate-500">{formatTimeLabel(entry.logged_at)}</div>
                        {entry.notes ? <div className="mt-2 text-sm text-slate-600">{entry.notes}</div> : null}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <ActionButton tone="secondary" onClick={() => { setEditingWeightId(entry.id); setWeightDraft(toWeightEntryDraft(entry, weightUnit)) }} className="w-auto" disabled={!isOnline || !isEditableDay}>
                          Edit
                        </ActionButton>
                        <ActionButton
                          tone="secondary"
                          onClick={() => setConfirmRequest({
                            title: 'Delete this weight entry?',
                            body: `Type ${formatMass(entry.weight_kg, weightUnit)} to confirm deleting this entry.`,
                            confirmLabel: 'Delete weight',
                            confirmationValue: formatMass(entry.weight_kg, weightUnit),
                            confirmationHint: `Type ${formatMass(entry.weight_kg, weightUnit)} to confirm`,
                            isPending: deleteWeight.isPending,
                            onConfirm: () => deleteWeight.mutate(entry.id),
                          })}
                          className="w-auto"
                          disabled={!isOnline || !isEditableDay}
                        >
                          Delete
                        </ActionButton>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="No weight entries on this day" body="Use the editor below to log one." />
            )}

            <div className="mt-4 rounded-[22px] bg-slate-50 p-4 ring-1 ring-slate-200">
              <div className="mb-3 font-semibold text-slate-950">{editingWeightId ? 'Edit weight entry' : 'New weight entry'}</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <LabelledInput label="Logged at" type="datetime-local" value={weightDraft.logged_at} onChange={(value) => setWeightDraft((current) => ({ ...current, logged_at: value }))} disabled={!isEditableDay} />
                <LabelledInput label={`Weight (${weightUnitLabel})`} type="number" value={weightDraft.weight_kg} onChange={(value) => setWeightDraft((current) => ({ ...current, weight_kg: value }))} error={weightErrors.weight || undefined} disabled={!isEditableDay} />
                <LabelledInput label="Body fat %" type="number" value={weightDraft.body_fat_pct} onChange={(value) => setWeightDraft((current) => ({ ...current, body_fat_pct: value }))} error={weightErrors.bodyFat || undefined} disabled={!isEditableDay} />
                <LabelledInput label="Waist (cm)" type="number" value={weightDraft.waist_cm} onChange={(value) => setWeightDraft((current) => ({ ...current, waist_cm: value }))} error={weightErrors.waist || undefined} disabled={!isEditableDay} />
              </div>
              <div className="mt-3">
                <LabelledTextArea label="Notes" value={weightDraft.notes} onChange={(value) => setWeightDraft((current) => ({ ...current, notes: value }))} rows={2} disabled={!isEditableDay} />
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <ActionButton onClick={() => saveWeight.mutate()} className="w-auto" disabled={weightDraftInvalid || saveWeight.isPending || !isEditableDay}>
                  {saveWeight.isPending ? 'Saving...' : editingWeightId ? 'Save weight' : 'Create weight'}
                </ActionButton>
                {editingWeightId ? (
                  <ActionButton tone="secondary" onClick={() => { setEditingWeightId(null); setWeightDraft(createWeightEntryDraft(selectedDate, todayDateKey)) }} className="w-auto">
                    Cancel
                  </ActionButton>
                ) : null}
                <Link to="/weight" className="inline-flex min-h-[48px] items-center justify-center rounded-full bg-white px-5 py-3 text-sm font-semibold text-slate-900 ring-1 ring-slate-200">
                  Trend view
                </Link>
              </div>
              {saveWeight.isError ? <div className="app-status app-status-danger mt-3 rounded-[22px] px-4 py-3 text-sm">{saveWeight.error.message}</div> : null}
            </div>
          </Panel>

          <Panel title="Coach check-in" subtitle="Recovery and feeling markers for this specific day.">
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <LabelledInput label="Sleep hours" type="number" value={checkInDraft.sleep_hours} onChange={(value) => setCheckInDraft((current) => ({ ...current, sleep_hours: value }))} disabled={!isEditableDay || !isOnline} />
                <LabelledInput label="Readiness (1-5)" type="number" value={checkInDraft.readiness_1_5} onChange={(value) => setCheckInDraft((current) => ({ ...current, readiness_1_5: value }))} disabled={!isEditableDay || !isOnline} />
                <LabelledInput label="Soreness (1-5)" type="number" value={checkInDraft.soreness_1_5} onChange={(value) => setCheckInDraft((current) => ({ ...current, soreness_1_5: value }))} disabled={!isEditableDay || !isOnline} />
                <LabelledInput label="Hunger (1-5)" type="number" value={checkInDraft.hunger_1_5} onChange={(value) => setCheckInDraft((current) => ({ ...current, hunger_1_5: value }))} disabled={!isEditableDay || !isOnline} />
              </div>
              <LabelledTextArea label="Note" value={checkInDraft.note} onChange={(value) => setCheckInDraft((current) => ({ ...current, note: value }))} rows={3} disabled={!isEditableDay || !isOnline} />
              <div className="flex flex-wrap gap-2">
                <ActionButton onClick={() => saveCheckIn.mutate()} className="w-auto" disabled={saveCheckIn.isPending || Boolean(checkInError) || !isEditableDay || !isOnline}>
                  {saveCheckIn.isPending ? 'Saving...' : 'Save check-in'}
                </ActionButton>
                <Link to="/coach" className="inline-flex min-h-[48px] items-center justify-center rounded-full bg-white px-5 py-3 text-sm font-semibold text-slate-900 ring-1 ring-slate-200">
                  Coach hub
                </Link>
              </div>
              {checkInError ? <div className="app-status app-status-danger rounded-[22px] px-4 py-3 text-sm">{checkInError}</div> : null}
              {saveCheckIn.isError ? <div className="app-status app-status-danger rounded-[22px] px-4 py-3 text-sm">{saveCheckIn.error.message}</div> : null}
            </div>
          </Panel>
        </div>
      </div>

      <ConfirmSheet request={confirmRequest} onClose={() => setConfirmRequest(null)} />
    </div>
  )
}
