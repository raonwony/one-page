// 💡 아이디어 메모를 옵시디언 볼트의 inbox 폴더로 내보낸다 (맥 크롬 등 File System Access API가 되는 환경에서만).
// - 대상: 삭제되지 않았고 본문이 "💡"로 시작하는 메모. 폴더 하나당 한 번만 내보낸다.
// - 폴더 안의 기존 파일은 절대 덮어쓰거나 지우지 않고, 앱의 메모도 지우지 않는다.
// - 폴더 핸들과 "내보냄" 기록은 메모 데이터와 분리된 별도 IndexedDB(one_page_export)에 둔다.
import { openDB, type DBSchema } from 'idb'
import { getDb } from './db'
import { parseDate, type Memo } from './types'

type Perm = 'granted' | 'prompt' | 'denied'
type Dir = FileSystemDirectoryHandle & {
  queryPermission(d: { mode: 'readwrite' }): Promise<Perm>
  requestPermission(d: { mode: 'readwrite' }): Promise<Perm>
  isSameEntry(other: FileSystemHandle): Promise<boolean>
}

interface Config {
  handle: Dir
  folderId: string // 폴더를 새로 고를 때마다 바뀐다. 다른 폴더에는 처음부터 다시 내보내기 위함.
  enabled: boolean
  lastExportAt: number | null
}

interface ExportSchema extends DBSchema {
  kv: { key: string; value: Config }
  exported: { key: string; value: { key: string; memoId: string; folderId: string; file: string; at: number } }
}

const dbx = () =>
  openDB<ExportSchema>('one_page_export', 1, {
    upgrade(db) {
      db.createObjectStore('kv')
      db.createObjectStore('exported', { keyPath: 'key' })
    },
  })

const RW = { mode: 'readwrite' } as const
const BULB = '💡'
const BULB_AT_START = /^\s*💡/
const BULB_PREFIX = /^\s*💡[ \t]*/

export const isSupported = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window

// ---------------- 상태 (설정 화면 표시용) ----------------

export interface ExportStatus {
  supported: boolean
  configured: boolean
  enabled: boolean
  folderName: string | null
  permission: Perm | null
  lastExportAt: number | null
  pending: number
  error: string | null
  running: boolean
}

let status: ExportStatus = {
  supported: isSupported(), configured: false, enabled: false, folderName: null,
  permission: null, lastExportAt: null, pending: 0, error: null, running: false,
}
let lastError: string | null = null
const listeners = new Set<() => void>()
function setStatus(p: Partial<ExportStatus>) {
  status = { ...status, ...p }
  listeners.forEach((l) => l())
}
export const subscribeExport = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb) } }
export const getExportStatus = () => status

// ---------------- 대상 메모 판단 / 파일 이름·내용 만들기 ----------------

export const isIdeaBody = (body: string) => BULB_AT_START.test(body)
const stripBulb = (body: string) => body.replace(BULB_PREFIX, '')

export function isExportable(m: Memo): boolean {
  if (m.isDeleted || !isIdeaBody(m.body)) return false
  // 이미지 메모는 이번에는 내보내지 않고, 글이 있으면 글만 내보낸다.
  const text = stripBulb(m.body).trim()
  if (text) return true
  return m.type === 'link' && !!m.url
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0')
function parts(iso: string) {
  const d = new Date(parseDate(iso))
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    hm: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    hhmm: `${pad(d.getHours())}${pad(d.getMinutes())}`,
  }
}

const BAD_NAME_CHARS = /[&,/:?#[\]\\*"<>|]/g
const SUMMARY_MAX = 30 // 한글은 파일명에서 글자당 약 3바이트라서, 255바이트 한도를 넘지 않도록 30자까지만 쓴다.

function summaryOf(m: Memo): string {
  const text = stripBulb(m.body)
  let first = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l) ?? ''
  if (!first) first = (m.linkTitle ?? '').trim()
  if (!first && m.url) { try { first = new URL(m.url).host } catch { first = '' } }
  const cleaned = first.replace(BAD_NAME_CHARS, '').replace(/\s+/g, ' ').trim()
  return Array.from(cleaned).slice(0, SUMMARY_MAX).join('').trim()
}

export function candidateNames(m: Memo): string[] {
  const { date, hhmm } = parts(m.createdAt)
  const sum = summaryOf(m)
  const make = (...bits: (string | number)[]) => bits.filter((b) => b !== '').join(' ').normalize('NFC') + '.md'
  const names = [make(date, '아이디어', sum), make(date, hhmm, '아이디어', sum)]
  for (let n = 2; n <= 99; n++) names.push(make(date, hhmm, '아이디어', sum, n))
  return names
}

export function fileContent(m: Memo): string {
  const { date, hm } = parts(m.createdAt)
  const body = stripBulb(m.body).trimEnd()
  const extra: string[] = []
  if (m.type === 'link' && m.url) {
    if (m.linkTitle) extra.push(`제목: ${m.linkTitle}`)
    extra.push(`링크: ${m.url}`)
  }
  const text = [body, extra.join('\n')].filter(Boolean).join('\n\n')
  // 일부러 wiki: true는 넣지 않는다 (이 노트는 "내 노트"로 취급되어야 한다).
  return `---\nsource: one.page\nmemo_id: ${m.id}\ncreated: ${date} ${hm}\n---\n${text}\n`
}

// ---------------- 폴더에 쓰기 ----------------

async function exists(dir: Dir, name: string): Promise<boolean> {
  try {
    await dir.getFileHandle(name)
    return true
  } catch (e) {
    const n = (e as DOMException).name
    if (n === 'NotFoundError') return false
    if (n === 'TypeMismatchError') return true // 같은 이름의 폴더가 있으면 피한다
    throw e
  }
}

/** 기존 파일은 절대 덮어쓰지 않는다. 같은 이름이 있으면 시각, 그다음 숫자를 붙인 이름을 쓴다. */
async function writeMemo(dir: Dir, m: Memo): Promise<string> {
  for (const name of candidateNames(m)) {
    if (await exists(dir, name)) continue
    const fh = await dir.getFileHandle(name, { create: true })
    const w = await fh.createWritable()
    await w.write(fileContent(m))
    await w.close()
    return name
  }
  throw new Error('같은 이름의 파일이 너무 많아요')
}

function explain(e: unknown): string {
  const n = (e as DOMException)?.name
  if (n === 'NotAllowedError' || n === 'SecurityError') return '폴더 쓰기 권한이 없어요. "권한 다시 허용"을 눌러 주세요.'
  if (n === 'NotFoundError') return '폴더를 찾을 수 없어요. 폴더를 다시 골라 주세요.'
  if (n === 'NoModificationAllowedError') return '폴더에 쓸 수 없어요. (다른 앱이 사용 중이거나 읽기 전용일 수 있어요)'
  return e instanceof Error ? e.message : String(e)
}
const FATAL = new Set(['NotAllowedError', 'SecurityError', 'NotFoundError', 'InvalidStateError'])

// ---------------- 설정 읽기/쓰기 ----------------

async function loadConfig(): Promise<Config | null> {
  try {
    return (await (await dbx()).get('kv', 'config')) ?? null
  } catch {
    return null
  }
}
async function saveConfig(c: Config) {
  await (await dbx()).put('kv', c, 'config')
}

async function permissionOf(h: Dir): Promise<Perm> {
  try { return await h.queryPermission(RW) } catch { return 'prompt' }
}

async function pendingFor(folderId: string): Promise<Memo[]> {
  const [memos, done] = await Promise.all([
    getDb().then((d) => d.getAll('memos')),
    dbx().then((d) => d.getAllKeys('exported')),
  ])
  const doneSet = new Set(done as string[])
  return memos
    .filter((m) => isExportable(m) && !doneSet.has(`${folderId}:${m.id}`))
    .sort((a, b) => parseDate(a.createdAt) - parseDate(b.createdAt))
}

/** 설정 화면·상태 표시를 최신으로 맞춘다. 권한 창을 띄우지는 않는다. */
export async function refreshExportStatus() {
  if (!isSupported()) return
  const cfg = await loadConfig()
  if (!cfg) { setStatus({ configured: false, enabled: false, folderName: null, permission: null, pending: 0, error: null }); return }
  const [permission, pending] = await Promise.all([permissionOf(cfg.handle), pendingFor(cfg.folderId)])
  setStatus({
    configured: true, enabled: cfg.enabled, folderName: cfg.handle.name, permission,
    lastExportAt: cfg.lastExportAt, pending: cfg.enabled ? pending.length : 0, error: lastError,
  })
}

// ---------------- 내보내기 실행 ----------------

let running: Promise<number> | null = null

/** 아직 내보내지 않은 💡 메모를 폴더에 쓴다. 쓴 개수를 돌려준다. 여러 번 불려도 한 번에 하나만 돈다. */
export function runExport(): Promise<number> {
  if (!isSupported()) return Promise.resolve(0)
  running ??= (async () => {
    try {
      // 앱을 두 창에서 열어 둔 경우에도 같은 메모가 두 번 생기지 않도록 창끼리도 순서를 맞춘다.
      return navigator.locks ? await navigator.locks.request('onepage-obsidian-export', doExport) : await doExport()
    } finally {
      running = null
      setStatus({ running: false })
    }
  })()
  return running
}

async function doExport(): Promise<number> {
  const cfg = await loadConfig()
  if (!cfg || !cfg.enabled) { await refreshExportStatus(); return 0 }
  setStatus({ running: true })
  const targets = await pendingFor(cfg.folderId)
  if (targets.length === 0) { lastError = null; await refreshExportStatus(); return 0 }
  if ((await permissionOf(cfg.handle)) !== 'granted') {
    lastError = '폴더 권한이 필요해요. "권한 다시 허용"을 눌러 주세요.'
    await refreshExportStatus()
    return 0
  }
  let written = 0
  let failure: string | null = null
  const store = await dbx()
  for (const m of targets) {
    try {
      const file = await writeMemo(cfg.handle, m)
      // 파일이 실제로 써진 뒤에만 "내보냄"으로 기록한다.
      await store.put('exported', { key: `${cfg.folderId}:${m.id}`, memoId: m.id, folderId: cfg.folderId, file, at: Date.now() })
      written++
    } catch (e) {
      failure = explain(e)
      if (FATAL.has((e as DOMException)?.name)) break
    }
  }
  lastError = failure
  if (written > 0) await saveConfig({ ...(await loadConfig() ?? cfg), lastExportAt: Date.now() })
  await refreshExportStatus()
  return written
}

// ---------------- 설정 화면 동작 ----------------

/**
 * 폴더를 고른다. 같은 폴더를 다시 고르면 기록을 이어 쓰고, 다른 폴더면 처음부터 다시 내보낸다.
 * confirmBacklog가 false를 돌려주면(= 사용자가 취소) 아무것도 바꾸지 않는다.
 * 돌려주는 값: 'cancelled' | 'ok'
 */
export async function chooseFolder(confirmBacklog: (count: number, folderName: string) => boolean): Promise<'cancelled' | 'ok'> {
  const picker = (window as unknown as { showDirectoryPicker: (o: object) => Promise<Dir> }).showDirectoryPicker
  let handle: Dir
  try {
    handle = await picker.call(window, { id: 'onepage-inbox', mode: 'readwrite', startIn: 'documents' })
  } catch (e) {
    if ((e as DOMException)?.name === 'AbortError') return 'cancelled'
    throw e
  }
  const prev = await loadConfig()
  let folderId: string = crypto.randomUUID()
  if (prev) {
    try { if (await prev.handle.isSameEntry(handle)) folderId = prev.folderId } catch { /* 새 폴더로 취급 */ }
  }
  const backlog = (await pendingFor(folderId)).length
  if (backlog > 0 && !confirmBacklog(backlog, handle.name)) return 'cancelled'
  lastError = null
  await saveConfig({ handle, folderId, enabled: true, lastExportAt: folderId === prev?.folderId ? prev.lastExportAt : null })
  await refreshExportStatus()
  await runExport()
  return 'ok'
}

/** 크롬이 권한을 다시 물을 때 쓴다. 반드시 사용자가 버튼을 누른 직후에 불러야 한다. */
export async function reauthorize(): Promise<Perm> {
  const cfg = await loadConfig()
  if (!cfg) return 'denied'
  const p = await cfg.handle.requestPermission(RW)
  if (p === 'granted') { lastError = null; await runExport() }
  await refreshExportStatus()
  return p
}

export async function setExportEnabled(enabled: boolean) {
  const cfg = await loadConfig()
  if (!cfg) return
  await saveConfig({ ...cfg, enabled })
  lastError = null
  await refreshExportStatus()
  if (enabled) await runExport()
}

export { BULB }
