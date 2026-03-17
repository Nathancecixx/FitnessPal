import { useQueryClient } from '@tanstack/react-query'
import { useRouterState } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'

import type { SessionInfo } from './api'

type DraftEnvelope<T> = {
  value: T
  saved_at: string
}

type UseDraftStateOptions<T> = {
  formId: string
  initialValue: T
  route?: string
  enabled?: boolean
}

const DRAFT_STORAGE_PREFIX = 'fitnesspal-drafts-v1'

function isBrowser() {
  return typeof window !== 'undefined'
}

function buildDraftStorageKey(userId: string, route: string, formId: string) {
  return `${DRAFT_STORAGE_PREFIX}:${userId}:${route}:${formId}`
}

function readDraftEnvelope<T>(storageKey: string): DraftEnvelope<T> | null {
  if (!isBrowser()) {
    return null
  }

  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) {
      return null
    }
    return JSON.parse(raw) as DraftEnvelope<T>
  } catch {
    return null
  }
}

function writeDraftEnvelope<T>(storageKey: string, value: T) {
  if (!isBrowser()) {
    return null
  }

  const nextEnvelope: DraftEnvelope<T> = {
    value,
    saved_at: new Date().toISOString(),
  }
  window.localStorage.setItem(storageKey, JSON.stringify(nextEnvelope))
  return nextEnvelope.saved_at
}

function clearDraftEnvelope(storageKey: string) {
  if (!isBrowser()) {
    return
  }
  window.localStorage.removeItem(storageKey)
}

export function useDraftState<T>(options: UseDraftStateOptions<T>) {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const queryClient = useQueryClient()
  const initialValueRef = useRef(options.initialValue)
  initialValueRef.current = options.initialValue

  const session = queryClient.getQueryData<SessionInfo>(['session'])
  const route = options.route ?? pathname
  const userId = session?.user?.id ?? 'anonymous'
  const enabled = options.enabled ?? true
  const storageKey = useMemo(() => buildDraftStorageKey(userId, route, options.formId), [options.formId, route, userId])

  const [value, setValue] = useState<T>(options.initialValue)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [restored, setRestored] = useState(false)
  const [hydratedKey, setHydratedKey] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) {
      setValue(initialValueRef.current)
      setSavedAt(null)
      setRestored(false)
      setHydratedKey(storageKey)
      return
    }

    const stored = readDraftEnvelope<T>(storageKey)
    if (stored) {
      setValue(stored.value)
      setSavedAt(stored.saved_at)
      setRestored(true)
    } else {
      setValue(initialValueRef.current)
      setSavedAt(null)
      setRestored(false)
    }
    setHydratedKey(storageKey)
  }, [enabled, storageKey])

  useEffect(() => {
    if (!enabled || hydratedKey !== storageKey) {
      return
    }
    const nextSavedAt = writeDraftEnvelope(storageKey, value)
    setSavedAt(nextSavedAt)
  }, [enabled, hydratedKey, storageKey, value])

  function clearDraft() {
    clearDraftEnvelope(storageKey)
    setValue(initialValueRef.current)
    setSavedAt(null)
    setRestored(false)
  }

  return {
    value,
    setValue,
    meta: {
      savedAt,
      restored,
      clearDraft,
      storageKey,
    },
  }
}
