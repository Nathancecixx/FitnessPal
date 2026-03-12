export type WeightUnit = 'kg' | 'lbs'

export const DEFAULT_WEIGHT_UNIT: WeightUnit = 'kg'

const LBS_PER_KG = 2.2046226218

type MassFormatOptions = {
  decimals?: number
  includeUnit?: boolean
  signed?: boolean
}

function formatNumber(value: number, decimals: number, signed = false) {
  const formatted = value.toFixed(decimals)
  if (!signed || value < 0 || formatted.startsWith('-')) {
    return formatted
  }
  return `+${formatted}`
}

export function getWeightUnitLabel(unit: WeightUnit) {
  return unit === 'lbs' ? 'lbs' : 'kg'
}

export function convertMassFromKg(valueKg: number, unit: WeightUnit) {
  return unit === 'lbs' ? valueKg * LBS_PER_KG : valueKg
}

export function convertMassToKg(value: number, unit: WeightUnit) {
  return unit === 'lbs' ? value / LBS_PER_KG : value
}

export function formatMass(valueKg: number | null | undefined, unit: WeightUnit, options: MassFormatOptions = {}) {
  if (valueKg == null || Number.isNaN(valueKg)) {
    return 'n/a'
  }

  const decimals = options.decimals ?? 1
  const converted = convertMassFromKg(valueKg, unit)
  const formatted = formatNumber(converted, decimals, options.signed)
  return options.includeUnit === false ? formatted : `${formatted} ${getWeightUnitLabel(unit)}`
}

export function formatMassRate(valueKgPerWeek: number | null | undefined, unit: WeightUnit, options: MassFormatOptions = {}) {
  if (valueKgPerWeek == null || Number.isNaN(valueKgPerWeek)) {
    return 'n/a'
  }

  const decimals = options.decimals ?? 2
  const converted = convertMassFromKg(valueKgPerWeek, unit)
  const formatted = formatNumber(converted, decimals, options.signed)
  return options.includeUnit === false ? formatted : `${formatted} ${getWeightUnitLabel(unit)}/week`
}

export function formatMassInput(valueKg: number, unit: WeightUnit, decimals = 1) {
  return Number(convertMassFromKg(valueKg, unit).toFixed(decimals)).toString()
}
