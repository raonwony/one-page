// 새 버전이 배포되면 알려 준다. 웹앱은 새 버전을 받아도 화면을 다시 열기 전까지는 옛 코드로 돌아가므로,
// 기기마다 버전이 달라 동기화가 느려 보이는 일을 막기 위해 눌러서 바로 업데이트하게 한다.

let available = false
const listeners = new Set<() => void>()
export const subscribeUpdate = (cb: () => void) => { listeners.add(cb); return () => listeners.delete(cb) }
export const isUpdateAvailable = () => available

export function watchForUpdates() {
  if (!('serviceWorker' in navigator)) return
  const hadController = !!navigator.serviceWorker.controller
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return // 처음 설치일 때는 해당 없음
    available = true
    listeners.forEach((l) => l())
  })
  const check = () => { void navigator.serviceWorker.getRegistration().then((r) => r?.update()).catch(() => {}) }
  check()
  window.setInterval(() => { if (document.visibilityState === 'visible') check() }, 5 * 60_000)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check() })
}
