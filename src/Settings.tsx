import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Icon } from './Icons'
import { getSyncState, signIn, signOut, subscribeSync, sync } from './drive'
import { exportPayload, mergeRemote } from './store'
import {
  chooseFolder, getExportStatus, refreshExportStatus, reauthorize, runExport, setExportEnabled, subscribeExport,
} from './obsidianExport'
import type { SyncPayload } from './types'

function lastTime(ts?: number) {
  if (!ts) return ''
  return new Date(ts).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
}

function ObsidianExport({ toast }: { toast: (m: string) => void }) {
  const ex = useSyncExternalStore(subscribeExport, getExportStatus)
  const [busy, setBusy] = useState(false)
  useEffect(() => { void refreshExportStatus() }, [])

  async function guard(fn: () => Promise<void>) {
    setBusy(true)
    try { await fn() } catch (e) { toast(`실패했어요: ${e instanceof Error ? e.message : e}`) } finally { setBusy(false) }
  }
  const pick = () => guard(async () => {
    const r = await chooseFolder((n, name) => window.confirm(`💡 메모 ${n}개를 "${name}" 폴더로 내보낼까요?\n(파일이 ${n}개 새로 생겨요. 기존 파일은 건드리지 않아요.)`))
    if (r === 'ok') toast('폴더를 연결했어요')
  })
  const now = () => guard(async () => {
    const n = await runExport()
    toast(n > 0 ? `${n}건 내보냈어요` : '내보낼 메모가 없어요')
  })
  const allow = () => guard(async () => {
    const p = await reauthorize()
    toast(p === 'granted' ? '권한을 허용했어요' : '권한이 허용되지 않았어요. 주소창 옆 자물쇠 아이콘에서 이 사이트의 파일 편집 권한을 확인해 주세요.')
  })

  return (
    <div className="card pad">
      <h3>옵시디언 내보내기</h3>
      {!ex.supported ? (
        <p className="hint">맥 크롬에서만 사용 가능해요. (이 브라우저는 앱이 폴더에 직접 저장하는 기능을 지원하지 않아요)</p>
      ) : (
        <>
          <p className="hint">메모 맨 앞에 💡를 붙이면, 고른 폴더(옵시디언 inbox)에 파일(.md)로 한 번만 내보내요. 사진 메모는 글만 내보내요.</p>
          {!ex.configured ? (
            <div className="row">
              <button className="btn primary" disabled={busy} onClick={() => void pick()}>폴더 고르기</button>
            </div>
          ) : (
            <>
              <p className="hint">폴더: <b>{ex.folderName}</b> · {ex.enabled ? '켜짐' : '꺼짐'}</p>
              {ex.lastExportAt && <p className="hint">마지막 내보내기 {new Date(ex.lastExportAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>}
              {ex.enabled && <p className={'hint' + (ex.pending > 0 ? ' warn' : '')}>내보내기 대기 {ex.pending}건</p>}
              {ex.permission !== 'granted' && ex.enabled && !ex.error && <p className="hint warn">폴더 권한이 필요해요. 아래 버튼으로 다시 허용해 주세요.</p>}
              {ex.error && <p className="hint error">{ex.error}</p>}
              <div className="row">
                {ex.enabled && ex.permission !== 'granted' && (
                  <button className="btn primary" disabled={busy} onClick={() => void allow()}>권한 다시 허용</button>
                )}
                {ex.enabled && (
                  <button className="btn primary" disabled={busy || ex.running || ex.permission !== 'granted'} onClick={() => void now()}>
                    <Icon name="upload" size={18} /> {ex.running ? '내보내는 중…' : '지금 내보내기'}
                  </button>
                )}
                <button className="btn" disabled={busy} onClick={() => void pick()}>폴더 변경</button>
                <button className="btn" disabled={busy} onClick={() => void guard(() => setExportEnabled(!ex.enabled))}>{ex.enabled ? '끄기' : '켜기'}</button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
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

        <ObsidianExport toast={toast} />

        <p className="hint">버전 {__BUILD_ID__}</p>
        <p className="hint">변경하면 몇 초 뒤 자동으로 올라가고, 앱을 닫거나 다시 열 때도 동기화돼요. 로그인이 풀려도 메모는 이 기기에 계속 저장돼요.</p>
      </div>
    </>
  )
}
