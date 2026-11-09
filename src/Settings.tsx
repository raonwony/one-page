import { useRef, useState, useSyncExternalStore } from 'react'
import { Icon } from './Icons'
import { getSyncState, signIn, signOut, subscribeSync, sync } from './drive'
import { exportPayload, mergeRemote } from './store'
import type { SyncPayload } from './types'

function lastTime(ts?: number) {
  if (!ts) return ''
  return new Date(ts).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
}

export function SettingsScreen({ toast }: { toast: (m: string) => void }) {
  const st = useSyncExternalStore(subscribeSync, getSyncState)
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  async function exportFile() {
    const data = await exportPayload()
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `one-page-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  async function importFile(f: File) {
    setBusy(true)
    try {
      const data = JSON.parse(await f.text()) as SyncPayload
      if (!Array.isArray(data.memos) || !Array.isArray(data.notes)) throw new Error('형식이 맞지 않아요')
      await mergeRemote(data)
      toast(`불러왔어요 (메모지 ${data.memos.length}개, 노트 ${data.notes.length}개)`)
    } catch (e) {
      toast(`불러오지 못했어요: ${e instanceof Error ? e.message : e}`)
    } finally {
      setBusy(false)
    }
  }

  const email = 'email' in st ? st.email : null
  return (
    <>
      <header className="appbar"><h1>설정</h1></header>
      <div className="content">
        <div className="card pad">
          <h3>Google Drive 동기화</h3>
          {st.kind === 'signedOut' && (
            <>
              <p className="hint">로그인하면 여러 기기에서 메모지를 이어볼 수 있어요. 앱 전용 숨김 공간에만 저장돼요.</p>
              <button className="btn primary" onClick={() => void signIn()}>Google 계정으로 로그인</button>
            </>
          )}
          {st.kind !== 'signedOut' && (
            <>
              <p className="hint">{email ? `${email}로 로그인됨` : '로그인됨'}</p>
              {st.kind === 'needsAuth' && <p className="hint warn">로그인이 풀렸어요. 아래 버튼으로 다시 연결해 주세요. (내용은 이 기기에 그대로 있어요)</p>}
              {st.kind === 'error' && <p className="hint error">동기화 실패: {st.message}</p>}
              {st.kind === 'idle' && st.lastSyncAt && <p className="hint">마지막 동기화 {lastTime(st.lastSyncAt)}</p>}
              <div className="row">
                <button className="btn primary" disabled={st.kind === 'syncing'} onClick={() => void sync(true)}>
                  <Icon name="refresh" size={18} /> {st.kind === 'syncing' ? '동기화 중…' : st.kind === 'needsAuth' ? '다시 연결하고 동기화' : '지금 동기화'}
                </button>
                <button className="btn" onClick={signOut}>로그아웃</button>
              </div>
            </>
          )}
        </div>

        <div className="card pad">
          <h3>기기에 백업</h3>
          <p className="hint">파일로 내보내거나, 이전에 내보낸 파일을 불러와 합칠 수 있어요.</p>
          <div className="row">
            <button className="btn" onClick={() => void exportFile()}><Icon name="download" size={18} /> 내보내기</button>
            <button className="btn" disabled={busy} onClick={() => fileRef.current?.click()}><Icon name="upload" size={18} /> 불러오기</button>
            <input ref={fileRef} type="file" accept="application/json,.json" hidden
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = '' }} />
          </div>
        </div>

        <p className="hint">버전 {__BUILD_ID__}</p>
        <p className="hint">변경하면 몇 초 뒤 자동으로 올라가고, 앱을 닫거나 다시 열 때도 동기화돼요. 로그인이 풀려도 메모는 이 기기에 계속 저장돼요.</p>
      </div>
    </>
  )
}
