import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { getSyncState, hasPendingChanges, subscribeSync, sync } from './drive'
import { Icon } from './Icons'
import { InboxScreen, NoteDetailScreen, NoteListScreen } from './Screens'
import { SettingsScreen } from './Settings'
import { CaptureSheet } from './Sheets'
import { createFromRawText, useStore } from './store'

type Tab = 'inbox' | 'notes' | 'settings'

/** 동기화가 끊기거나 실패했을 때 화면 맨 위에 눈에 띄게 알린다. 눌러서 바로 다시 연결/재시도. */
function SyncBanner() {
  const st = useSyncExternalStore(subscribeSync, getSyncState)
  const pending = useSyncExternalStore(subscribeSync, hasPendingChanges)
  if (st.kind !== 'needsAuth' && st.kind !== 'error') return null
  const msg = st.kind === 'needsAuth'
    ? (pending ? '구글 연결이 끊겨서 아직 올리지 못한 메모가 있어요' : '구글 연결이 끊겼어요')
    : (pending ? '동기화에 실패해서 아직 올리지 못한 메모가 있어요' : '동기화에 실패했어요')
  return (
    <button className="sync-banner" onClick={() => void sync(true)}>
      <Icon name="refresh" size={16} />
      <span>{msg} · 눌러서 {st.kind === 'needsAuth' ? '다시 연결' : '다시 시도'}</span>
    </button>
  )
}

export default function App() {
  const s = useStore()
  const [tab, setTab] = useState<Tab>('inbox')
  const [noteId, setNoteId] = useState<string | null>(null)
  const [capturing, setCapturing] = useState(false)
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)

  const toast = useCallback((m: string) => {
    setToastMsg(m)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToastMsg(null), 2600)
  }, [])

  // 노트 상세는 브라우저 기록에 쌓아서 안드로이드 뒤로가기가 자연스럽게 동작하게 한다.
  const openNote = useCallback((id: string) => {
    history.pushState({ noteId: id }, '')
    setNoteId(id)
    setTab('notes')
  }, [])
  const closeNote = useCallback(() => {
    if (history.state?.noteId) history.back()
    else setNoteId(null)
  }, [])
  useEffect(() => {
    const onPop = () => setNoteId(history.state?.noteId ?? null)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // 홈 화면 바로가기(?capture=1)와 안드로이드 공유(?title&text&url) 처리
  const handledLaunch = useRef(false)
  useEffect(() => {
    if (!s.ready || handledLaunch.current) return
    handledLaunch.current = true
    const q = new URLSearchParams(location.search)
    const shared = [q.get('text'), q.get('url')].filter(Boolean).join('\n').trim()
    if (shared) {
      void createFromRawText(shared).then(() => toast('받은함에 저장했어요'))
    } else if (q.get('capture')) {
      setCapturing(true)
    }
    if (q.toString()) history.replaceState(null, '', location.pathname)
  }, [s.ready, toast])

  if (!s.ready) return <div className="splash">One.Page</div>

  return (
    <div className="app">
      <SyncBanner />
      <main className="screen">
        {noteId ? (
          <NoteDetailScreen noteId={noteId} back={closeNote} toast={toast} />
        ) : tab === 'inbox' ? (
          <InboxScreen openNote={openNote} toast={toast} />
        ) : tab === 'notes' ? (
          <NoteListScreen openNote={openNote} />
        ) : (
          <SettingsScreen toast={toast} />
        )}
      </main>

      {!noteId && (
        <button className="fab" aria-label="빠른 메모" onClick={() => setCapturing(true)}><Icon name="plus" size={26} /></button>
      )}

      {!noteId && (
        <nav className="tabbar">
          <button className={tab === 'inbox' ? 'on' : ''} onClick={() => setTab('inbox')}><Icon name="inbox" /><span>받은함</span></button>
          <button className={tab === 'notes' ? 'on' : ''} onClick={() => setTab('notes')}><Icon name="note" /><span>노트</span></button>
          <button className={tab === 'settings' ? 'on' : ''} onClick={() => setTab('settings')}><Icon name="settings" /><span>설정</span></button>
        </nav>
      )}

      {capturing && <CaptureSheet onClose={() => setCapturing(false)} onSaved={toast} />}
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </div>
  )
}
