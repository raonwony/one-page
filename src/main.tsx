import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { getSyncState, onSyncDone, scheduleSync, startAutoSync } from './drive'
import { backfillArchive, initStore, onLocalChange } from './store'
import { refreshExportStatus, runExport } from './obsidianExport'
import { watchForUpdates } from './update'
import './index.css'

onLocalChange(() => {
  scheduleSync()
  // 동기화가 잘 되는 중이면 끝난 직후에 내보낸다. 로그인을 안 쓰거나 연결이 끊겨 동기화가 안 되는 상태면 저장한 뒤 바로 내보낸다.
  const k = getSyncState().kind
  if (k === 'idle' || k === 'syncing') void refreshExportStatus()
  else void runExport()
})
// 동기화가 끝난 직후에 💡 메모를 옵시디언 폴더로 내보낸다.
onSyncDone(() => void runExport())
watchForUpdates()
initStore().then(async () => {
  await backfillArchive().catch(() => {}) // '자리 찾은 메모' 노트에 이미 노트로 옮겨진 메모지를 한 번 모은다
  startAutoSync()
  void runExport() // 앱을 열 때 (로그인이 풀려 있어도 이 기기의 메모는 내보낸다)
})
// 폴더 권한은 크롬이 바꿀 수 있어서, 앱으로 돌아올 때마다 상태를 다시 확인한다.
window.addEventListener('focus', () => void refreshExportStatus())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
