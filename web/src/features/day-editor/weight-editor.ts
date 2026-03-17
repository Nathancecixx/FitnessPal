import type { WeightEntry } from '../../lib/api'
import { createDateTimeInputValue, toIsoFromDateTimeInput, toLocalDateTimeInputValue } from '../../lib/date'
import { convertMassToKg, formatMassInput, type WeightUnit } from '../../lib/weight-units'

export type WeightEntryDraft = {
  logged_at: string
  weight_kg: string
  body_fat_pct: string
  waist_cm: string
  notes: string
}

export function createWeightEntryDraft(dateKey: string, todayDateKey: string, fallbackTime = '08:00'): WeightEntryDraft {
  return {
    logged_at: createDateTimeInputValue(dateKey, fallbackTime, todayDateKey),
    weight_kg: '',
    body_fat_pct: '',
    waist_cm: '',
    notes: '',
  }
}

export function toWeightEntryDraft(entry: WeightEntry, weightUnit: WeightUnit): WeightEntryDraft {
  return {
    logged_at: toLocalDateTimeInputValue(entry.logged_at),
    weight_kg: formatMassInput(entry.weight_kg, weightUnit),
    body_fat_pct: entry.body_fat_pct != null ? String(entry.body_fat_pct) : '',
    waist_cm: entry.waist_cm != null ? String(entry.waist_cm) : '',
    notes: entry.notes ?? '',
  }
}

export function getWeightDraftErrors(draft: WeightEntryDraft) {
  return {
    weight: !draft.weight_kg.trim()
      ? 'Weight is required.'
      : Number(draft.weight_kg) <= 0
        ? 'Weight must be greater than zero.'
        : '',
    bodyFat: draft.body_fat_pct && (Number(draft.body_fat_pct) < 0 || Number(draft.body_fat_pct) > 100)
      ? 'Body fat must stay between 0 and 100.'
      : '',
    waist: draft.waist_cm && Number(draft.waist_cm) <= 0
      ? 'Waist must be greater than zero.'
      : '',
  }
}

export function buildWeightEntryPayload(draft: WeightEntryDraft, weightUnit: WeightUnit) {
  return {
    logged_at: toIsoFromDateTimeInput(draft.logged_at),
    weight_kg: convertMassToKg(Number(draft.weight_kg), weightUnit),
    body_fat_pct: draft.body_fat_pct ? Number(draft.body_fat_pct) : null,
    waist_cm: draft.waist_cm ? Number(draft.waist_cm) : null,
    notes: draft.notes || null,
  }
}
