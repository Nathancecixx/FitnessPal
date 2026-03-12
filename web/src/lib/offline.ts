export type QueuedSyncRequest = {
  id: string
  method: string
  path: string
  body?: string
  headers?: Record<string, string>
  created_at: string
}

export type SyncState = {
  isOnline: boolean
  queuedCount: number
  isFlushing: boolean
  lastFlushedAt?: string | null
}

type CachedResponseRecord = {
  data: unknown
  cached_at: string
}

const OUTBOX_STORAGE_KEY = 'fitnesspal-sync-outbox-v1'
const RESPONSE_CACHE_STORAGE_KEY = 'fitnesspal-api-cache-v1'
const LAST_FLUSH_STORAGE_KEY = 'fitnesspal-sync-last-flush-v1'
const SYNC_NAMESPACE_STORAGE_KEY = 'fitnesspal-sync-namespace-v1'

const listeners = new Set<(state: SyncState) => void>()
let isFlushing = false

function isBrowser() {
  return typeof window !== 'undefined'
}

function readJson<T>(key: string, fallback: T): T {
  if (!isBrowser()) {
    return fallback
  }

  try {
    const raw = window.localStorage.getItem(key)
    return raw ? JSON.parse(raw) as T : fallback
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown) {
  if (!isBrowser()) {
    return
  }
  window.localStorage.setItem(key, JSON.stringify(value))
}

function readNamespace() {
  if (!isBrowser()) {
    return 'anonymous'
  }
  return window.localStorage.getItem(SYNC_NAMESPACE_STORAGE_KEY) ?? 'anonymous'
}

function namespacedKey(key: string) {
  return `${key}:${readNamespace()}`
}

function readOutbox() {
  return readJson<QueuedSyncRequest[]>(namespacedKey(OUTBOX_STORAGE_KEY), [])
}

function writeOutbox(items: QueuedSyncRequest[]) {
  writeJson(namespacedKey(OUTBOX_STORAGE_KEY), items)
  emitSyncState()
}

function emitSyncState() {
  const nextState = getSyncState()
  listeners.forEach((listener) => listener(nextState))
}

export function getSyncState(): SyncState {
  return {
    isOnline: isBrowser() ? window.navigator.onLine : true,
    queuedCount: readOutbox().length,
    isFlushing,
    lastFlushedAt: isBrowser() ? window.localStorage.getItem(namespacedKey(LAST_FLUSH_STORAGE_KEY)) : null,
  }
}

export function setSyncNamespace(namespace: string | null | undefined) {
  if (!isBrowser()) {
    return
  }
  window.localStorage.setItem(SYNC_NAMESPACE_STORAGE_KEY, namespace || 'anonymous')
  emitSyncState()
}

export function subscribeSyncState(listener: (state: SyncState) => void) {
  listeners.add(listener)
  listener(getSyncState())
  return () => {
    listeners.delete(listener)
  }
}

export function enqueueSyncRequest(request: QueuedSyncRequest) {
  writeOutbox([...readOutbox(), request])
}

export function listQueuedSyncRequests() {
  return readOutbox()
}

export function removeQueuedSyncRequest(requestId: string) {
  writeOutbox(readOutbox().filter((item) => item.id !== requestId))
}

export function setSyncFlushing(nextValue: boolean) {
  isFlushing = nextValue
  emitSyncState()
}

export function markSyncFlushComplete(timestamp: string) {
  if (isBrowser()) {
    window.localStorage.setItem(namespacedKey(LAST_FLUSH_STORAGE_KEY), timestamp)
  }
  emitSyncState()
}

export function cacheApiResponse(cacheKey: string, data: unknown) {
  const current = readJson<Record<string, CachedResponseRecord>>(namespacedKey(RESPONSE_CACHE_STORAGE_KEY), {})
  current[cacheKey] = { data, cached_at: new Date().toISOString() }
  writeJson(namespacedKey(RESPONSE_CACHE_STORAGE_KEY), current)
}

export function readCachedApiResponse<T>(cacheKey: string): T | null {
  const current = readJson<Record<string, CachedResponseRecord>>(namespacedKey(RESPONSE_CACHE_STORAGE_KEY), {})
  return (current[cacheKey]?.data as T | undefined) ?? null
}

if (isBrowser()) {
  window.addEventListener('online', emitSyncState)
  window.addEventListener('offline', emitSyncState)
}
