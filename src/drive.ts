import { BACKUP_FILE_NAME, GOOGLE_CLIENT_ID } from './config'
import { exportPayload, mergeRemote } from './store'
import type { SyncPayload } from './types'

const SCOPE = 'https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/userinfo.email'
const LS_SIGNED_IN = 'onepage.signedIn'
const LS_EMAIL = 'onepage.email'

type TokenResponse = { access_token?: string; expires_in?: number; error?: string }
type TokenClient = { requestAccessToken: (o?: { prompt?: string; login_hint?: string }) => void }

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (c: {
            client_id: string
            scope: string
            callback: (r: TokenResponse) => void
            error_callback?: (e: { type: string }) => void
          }) => TokenClient
          revoke: (token: string, done?: () => void) => void
        }
      }
    }
  }
}

export type SyncState =
  | { kind: 'signedOut' }
  | { kind: 'idle'; email: string | null; lastSyncAt?: number }
  | { kind: 'syncing'; email: string | null }
  | { kind: 'needsAuth'; email: string | null }
  | { kind: 'error'; email: string | null; message: string }

let syncState: SyncState = readInitialState()
const listeners = new Set<() => void>()

function readInitialState(): SyncState {
  try {
    if (localStorage.getItem(LS_SIGNED_IN) === '1') {
      return { kind: 'needsAuth', email: localStorage.getItem(LS_EMAIL) }
    }
  } catch { /* 저장소를 못 써도 로그아웃 상태로 시작 */ }
  return { kind: 'signedOut' }
}

function setState(s: SyncState) {
  syncState = s
  listeners.forEach((l) => l())
}

export function subscribeSync(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
export const getSyncState = () => syncState

// ---------------- Google Identity Services ----------------

let gisPromise: Promise<void> | null = null
function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve()
  gisPromise ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => {
      gisPromise = null
      reject(new Error('구글 로그인 스크립트를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.'))
    }
    document.head.appendChild(s)
  })
  return gisPromise
}

let token: { value: string; exp: number } | null = null
let client: TokenClient | null = null
let pending: { resolve: (t: string) => void; reject: (e: Error) => void } | null = null

async function ensureClient(): Promise<TokenClient> {
  await loadGis()
  client ??= window.google!.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: SCOPE,
    callback: (r) => {
      const p = pending
      pending = null
      if (!p) return
      if (r.access_token) {
        token = { value: r.access_token, exp: Date.now() + (r.expires_in ?? 3600) * 1000 - 60_000 }
        p.resolve(r.access_token)
      } else {
        p.reject(new Error(r.error ?? 'auth_failed'))
      }
    },
    error_callback: (e) => {
      const p = pending
      pending = null
      p?.reject(new Error(e.type))
    },
  })
  return client
}

/** interactive=false는 팝업 없이 조용히 갱신만 시도한다 (실패하면 reject). */
async function getToken(interactive: boolean): Promise<string> {
  if (token && token.exp > Date.now()) return token.value
  const c = await ensureClient()
  return new Promise<string>((resolve, reject) => {
    pending = { resolve, reject }
    const hint = safeGet(LS_EMAIL) ?? undefined
    c.requestAccessToken({ prompt: interactive ? '' : 'none', login_hint: hint })
    // 조용한 갱신이 응답 없이 멈추는 경우를 대비한 안전장치
    if (!interactive) {
      setTimeout(() => {
        if (pending?.reject === reject) {
          pending = null
          reject(new Error('silent_timeout'))
        }
      }, 8000)
    }
  })
}

function safeGet(k: string) {
  try { return localStorage.getItem(k) } catch { return null }
}
function safeSet(k: string, v: string | null) {
  try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v) } catch { /* ignore */ }
}

async function fetchEmail(t: string): Promise<string | null> {
  try {
    const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${t}` } })
    if (!r.ok) return null
    return ((await r.json()) as { email?: string }).email ?? null
  } catch { return null }
}

// ---------------- 공개 API ----------------

export async function signIn(): Promise<void> {
  try {
    const t = await getToken(true)
    const email = await fetchEmail(t)
    safeSet(LS_SIGNED_IN, '1')
    safeSet(LS_EMAIL, email)
    setState({ kind: 'idle', email })
    await sync(true)
  } catch (e) {
    setState({ kind: 'error', email: null, message: explain(e) })
  }
}

export function signOut() {
  if (token && window.google) window.google.accounts.oauth2.revoke(token.value)
  token = null
  safeSet(LS_SIGNED_IN, null)
  safeSet(LS_EMAIL, null)
  setState({ kind: 'signedOut' })
}

function explain(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  if (m === 'popup_closed' || m === 'access_denied') return '로그인 창이 닫혔어요.'
  if (m === 'popup_failed_to_open') return '팝업이 차단됐어요. 브라우저에서 이 사이트의 팝업을 허용해 주세요.'
  if (m.includes('redirect_uri_mismatch') || m.includes('origin_mismatch'))
    return '구글 클라우드 콘솔의 "승인된 자바스크립트 원본"에 이 주소를 추가해야 해요.'
  return m
}

// ---------------- Drive 동기화 ----------------

let running: Promise<boolean> | null = null

/**
 * 원격 파일을 받아 병합한 뒤, 병합된 전체 상태를 다시 올린다.
 * interactive=false면 팝업 없이 시도하고, 로그인이 풀려 있으면 '다시 연결 필요' 상태로만 표시한다.
 */
export function sync(interactive = false): Promise<boolean> {
  if (syncState.kind === 'signedOut') return Promise.resolve(false)
  running ??= doSync(interactive).finally(() => { running = null })
  return running
}

async function doSync(interactive: boolean): Promise<boolean> {
  const email = 'email' in syncState ? syncState.email : null
  setState({ kind: 'syncing', email })
  try {
    let t: string
    try {
      t = await getToken(interactive)
    } catch (e) {
      if (interactive) throw e
      setState({ kind: 'needsAuth', email })
      return false
    }
    try {
      await runSync(t)
    } catch (e) {
      if (e instanceof HttpError && e.status === 401) {
        token = null
        t = await getToken(interactive)
        await runSync(t)
      } else throw e
    }
    setState({ kind: 'idle', email, lastSyncAt: Date.now() })
    return true
  } catch (e) {
    if (e instanceof HttpError && e.status === 401) setState({ kind: 'needsAuth', email })
    else setState({ kind: 'error', email, message: explain(e) })
    return false
  }
}

class HttpError extends Error {
  constructor(public status: number, msg: string) { super(msg) }
}

async function api(t: string, url: string, init: RequestInit = {}): Promise<Response> {
  const r = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${t}` } })
  if (!r.ok) throw new HttpError(r.status, `Drive 요청 실패 (${r.status})`)
  return r
}

async function runSync(t: string) {
  const list = await api(
    t,
    'https://www.googleapis.com/drive/v3/files?' +
      new URLSearchParams({
        spaces: 'appDataFolder',
        q: `name = '${BACKUP_FILE_NAME}' and trashed = false`,
        fields: 'files(id,name)',
      }),
  )
  const files = ((await list.json()) as { files?: { id: string }[] }).files ?? []
  const fileId = files[0]?.id ?? null

  if (fileId) {
    const dl = await api(t, `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`)
    const remote = (await dl.json()) as SyncPayload
    await mergeRemote(remote)
  }

  const merged = await exportPayload()
  const body = JSON.stringify(merged)
  if (fileId) {
    await api(t, `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
  } else {
    const boundary = 'onepage' + Math.random().toString(36).slice(2)
    const meta = JSON.stringify({ name: BACKUP_FILE_NAME, parents: ['appDataFolder'] })
    const multipart =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
      `--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`
    await api(t, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: multipart,
    })
  }
}

// ---------------- 자동 동기화 ----------------

let debounce: number | undefined
/** 로컬에서 무언가 바뀌었을 때 잠시 뒤 조용히 올린다. */
export function scheduleSync() {
  if (syncState.kind === 'signedOut') return
  window.clearTimeout(debounce)
  debounce = window.setTimeout(() => void sync(false), 4000)
}

export function startAutoSync() {
  void sync(false)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void sync(false)
    else {
      window.clearTimeout(debounce)
      void sync(false)
    }
  })
}
