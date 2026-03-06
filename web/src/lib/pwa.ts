export function registerServiceWorker() {
  if (!import.meta.env.PROD) {
    return
  }
  if (!('serviceWorker' in navigator)) {
    return
  }
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/service-worker.js')
  })
}
