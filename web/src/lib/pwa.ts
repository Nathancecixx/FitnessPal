export type PwaState = {
  installAvailable: boolean
  updateAvailable: boolean
}

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

const listeners = new Set<(state: PwaState) => void>()
const pwaState: PwaState = {
  installAvailable: false,
  updateAvailable: false,
}

let deferredInstallPrompt: BeforeInstallPromptEvent | null = null

function emitPwaState() {
  const snapshot = { ...pwaState }
  listeners.forEach((listener) => listener(snapshot))
}

export function subscribePwaState(listener: (state: PwaState) => void) {
  listeners.add(listener)
  listener({ ...pwaState })
  return () => {
    listeners.delete(listener)
  }
}

export async function promptPwaInstall() {
  if (!deferredInstallPrompt) {
    return false
  }

  await deferredInstallPrompt.prompt()
  const result = await deferredInstallPrompt.userChoice
  if (result.outcome === 'accepted') {
    deferredInstallPrompt = null
    pwaState.installAvailable = false
    emitPwaState()
    return true
  }

  return false
}

export function clearPwaUpdateReady() {
  pwaState.updateAvailable = false
  emitPwaState()
}

export function registerServiceWorker() {
  if (!import.meta.env.PROD) {
    return
  }
  if (typeof window === 'undefined') {
    return
  }
  if (!('serviceWorker' in navigator)) {
    return
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    deferredInstallPrompt = event as BeforeInstallPromptEvent
    pwaState.installAvailable = true
    emitPwaState()
  })

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null
    pwaState.installAvailable = false
    emitPwaState()
  })

  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/service-worker.js').then((registration) => {
      registration.addEventListener('updatefound', () => {
        const installingWorker = registration.installing
        if (!installingWorker) {
          return
        }
        installingWorker.addEventListener('statechange', () => {
          if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
            pwaState.updateAvailable = true
            emitPwaState()
          }
        })
      })
    })
  })
}
