import type { MealEntry, MealEntryItem } from '../../lib/api'
import { createDateTimeInputValue, toIsoFromDateTimeInput, toLocalDateTimeInputValue } from '../../lib/date'

export type MealDraftItem = {
  label: string
  grams: string
  calories: string
  protein_g: string
  carbs_g: string
  fat_g: string
  fiber_g: string
  sodium_mg: string
  source_type: string
}

export type MealDraft = {
  meal_type: string
  logged_at: string
  notes: string
  items: MealDraftItem[]
}

export function createEmptyMealItem(): MealDraftItem {
  return {
    label: '',
    grams: '',
    calories: '0',
    protein_g: '0',
    carbs_g: '0',
    fat_g: '0',
    fiber_g: '0',
    sodium_mg: '0',
    source_type: 'manual',
  }
}

export function createMealDraft(dateKey: string, todayDateKey: string, fallbackTime = '12:00'): MealDraft {
  return {
    meal_type: 'meal',
    logged_at: createDateTimeInputValue(dateKey, fallbackTime, todayDateKey),
    notes: '',
    items: [createEmptyMealItem()],
  }
}

export function toMealDraftItem(item: MealEntryItem): MealDraftItem {
  return {
    label: item.label,
    grams: String(item.grams ?? ''),
    calories: String(item.calories ?? 0),
    protein_g: String(item.protein_g ?? 0),
    carbs_g: String(item.carbs_g ?? 0),
    fat_g: String(item.fat_g ?? 0),
    fiber_g: String(item.fiber_g ?? 0),
    sodium_mg: String(item.sodium_mg ?? 0),
    source_type: item.source_type,
  }
}

export function toMealDraft(meal: MealEntry): MealDraft {
  return {
    meal_type: meal.meal_type,
    logged_at: toLocalDateTimeInputValue(meal.logged_at),
    notes: meal.notes ?? '',
    items: meal.items.map((item) => toMealDraftItem(item)),
  }
}

export function isMealDraftInvalid(draft: MealDraft) {
  return !draft.meal_type
    || !draft.items.length
    || draft.items.some((item) => !item.label.trim() || Number(item.calories) < 0)
}

export function buildMealPayload(draft: MealDraft) {
  return {
    meal_type: draft.meal_type,
    logged_at: toIsoFromDateTimeInput(draft.logged_at),
    notes: draft.notes || undefined,
    source: 'manual',
    items: draft.items.map((item) => ({
      label: item.label,
      grams: item.grams ? Number(item.grams) : null,
      calories: Number(item.calories),
      protein_g: Number(item.protein_g),
      carbs_g: Number(item.carbs_g),
      fat_g: Number(item.fat_g),
      fiber_g: Number(item.fiber_g),
      sodium_mg: Number(item.sodium_mg),
      source_type: item.source_type,
    })),
  }
}
