import { useQuery } from '@tanstack/react-query'

import { api } from './api'
import { DEFAULT_WEIGHT_UNIT, type WeightUnit } from './weight-units'

export function useUserPreferencesQuery() {
  return useQuery({
    queryKey: ['user-preferences'],
    queryFn: api.getUserPreferences,
    staleTime: 60_000,
  })
}

export function useWeightUnit(): WeightUnit {
  return useUserPreferencesQuery().data?.weight_unit ?? DEFAULT_WEIGHT_UNIT
}
