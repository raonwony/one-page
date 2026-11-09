import { useSyncExternalStore } from 'react'
import { getDb } from './db'
import { DEFAULT_NOTE_ICON, parseDate, type Memo, type Note, type NoteMemoLink, type SyncPayload } from './types'

export interface State {
  ready: boolean
  memos: Memo[]
  notes: Note[]
  links: NoteMemoLink[]
}

let state: State = { ready: false, memos: [], notes: [], links: [] }
const listeners = new Set<() => void>()
let changeHook: (() => void) | null = null

function emit(next: Partial<State>) {
  state = { ...state, ...next }
  listeners.forEach((l) => l())
}

export function useStore(): State {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => state,
  )
}

/** 사용자가 데이터를 바꿀 때마다 호출될 훅 (자동 동기화 예약용) */
export function onLocalChange(fn: () => void) {
  changeHook = fn
}

const nowIso = () => new Date().toISOString()
const newId = () => crypto.randomUUID()

export async function initStore() {
  const db = await getDb()
  const [memos, notes, links] = await Promise.all([
    db.getAll('memos'),
    db.getAll('notes'),
    db.getAll('links'),
  ])
  emit({ ready: true, memos, notes, links })
}

async function reload() {
  const db = await getDb()
  const [memos, notes, links] = await Promise.all([
    db.getAll('memos'),
    db.getAll('notes'),
    db.getAll('links'),
  ])
  emit({ memos, notes, links })
}

async function afterWrite(userChange = true) {
  await reload()
  if (userChange) changeHook?.()
}

// ---------------- 조회용 헬퍼 ----------------

export const byCreatedDesc = (a: Memo, b: Memo) => parseDate(b.createdAt) - parseDate(a.createdAt)

export function inboxMemos(s: State): Memo[] {
  return s.memos.filter((m) => m.inInbox && !m.isDeleted).sort(byCreatedDesc)
}

export function allMemos(s: State): Memo[] {
  return s.memos.filter((m) => !m.isDeleted).sort(byCreatedDesc)
}

export function namedNotes(s: State): Note[] {
  return s.notes
    .filter((n) => n.kind === 'named' && !n.isDeleted)
    .sort((a, b) => parseDate(b.updatedAt) - parseDate(a.updatedAt))
}

export function dateNotes(s: State): Note[] {
  return s.notes
    .filter((n) => n.kind === 'date' && !n.isDeleted)
    .sort((a, b) => (b.noteDate ?? '').localeCompare(a.noteDate ?? ''))
}

export function memosOfNote(s: State, noteId: string): Memo[] {
  const byId = new Map(s.memos.map((m) => [m.id, m]))
  return s.links
    .filter((l) => l.noteId === noteId && !l.isDeleted)
    .sort((a, b) => a.position - b.position)
    .map((l) => byId.get(l.memoId))
    .filter((m): m is Memo => !!m && !m.isDeleted)
}

// ---------------- 메모지 ----------------

const URL_RE = /^(https?:\/\/)[^\s]+$/i
export const looksLikeUrl = (t: string) => URL_RE.test(t.trim())

function blankMemo(type: Memo['type']): Memo {
  const now = nowIso()
  return {
    id: newId(), type, body: '', url: null, linkTitle: null, linkDescription: null,
    linkImageUrl: null, imageExt: null, inInbox: true, createdAt: now, updatedAt: now, isDeleted: false,
  }
}

export async function createFromRawText(raw: string) {
  const t = raw.trim()
  if (!t) return
  const memo = blankMemo(looksLikeUrl(t) ? 'link' : 'text')
  if (memo.type === 'link') memo.url = t
  else memo.body = t
  const db = await getDb()
  await db.put('memos', memo)
  await afterWrite()
}

export async function updateMemoText(id: string, raw: string) {
  const t = raw.trim()
  const db = await getDb()
  const memo = await db.get('memos', id)
  if (!memo) return
  const isLink = looksLikeUrl(t)
  await db.put('memos', {
    ...memo,
    type: isLink ? 'link' : 'text',
    url: isLink ? t : null,
    body: isLink ? '' : t,
    linkTitle: null,
    linkDescription: null,
    linkImageUrl: null,
    updatedAt: nowIso(),
  })
  await afterWrite()
}

export async function createImageMemo(blob: Blob, ext: string) {
  const memo = blankMemo('image')
  memo.imageExt = ext
  const db = await getDb()
  await db.put('images', { id: memo.id, blob, ext })
  await db.put('memos', memo)
  await afterWrite()
}

/**
 * 빠른 메모 저장: 글과 이미지를 한 번에 받은함에 넣는다.
 * 메모지 하나는 글/링크/이미지 중 한 종류라서(기존 앱과 같은 구조), 글과 이미지는 각각의 메모지로 저장된다.
 * 받은함은 최신순이라 글이 위, 사진이 그 아래에 오도록 생성 시각을 1ms씩 어긋나게 한다.
 */
export async function createCaptured(raw: string, images: { blob: Blob; ext: string }[]) {
  const t = raw.trim()
  if (!t && images.length === 0) return
  const db = await getDb()
  const base = Date.now()
  const stamp = (i: number) => new Date(base + i).toISOString()
  for (let i = 0; i < images.length; i++) {
    const memo = blankMemo('image')
    memo.imageExt = images[i].ext
    memo.createdAt = memo.updatedAt = stamp(images.length - 1 - i)
    await db.put('images', { id: memo.id, blob: images[i].blob, ext: images[i].ext })
    await db.put('memos', memo)
  }
  if (t) {
    const memo = blankMemo(looksLikeUrl(t) ? 'link' : 'text')
    if (memo.type === 'link') memo.url = t
    else memo.body = t
    memo.createdAt = memo.updatedAt = stamp(images.length)
    await db.put('memos', memo)
  }
  await afterWrite()
}

export async function getImageBlob(memoId: string): Promise<Blob | null> {
  const db = await getDb()
  return (await db.get('images', memoId))?.blob ?? null
}

export async function deleteMemo(id: string) {
  const db = await getDb()
  const memo = await db.get('memos', id)
  if (!memo) return
  await db.put('memos', { ...memo, isDeleted: true, updatedAt: nowIso() })
  await afterWrite()
}

// ---------------- 노트 ----------------

function blankNote(kind: Note['kind']): Note {
  const now = nowIso()
  return {
    id: newId(), kind, name: null, icon: null, noteDate: null, body: '',
    createdAt: now, updatedAt: now, isDeleted: false,
  }
}

export async function createNamedNote(name: string, icon: string): Promise<Note> {
  const note = blankNote('named')
  note.name = name
  note.icon = icon || DEFAULT_NOTE_ICON
  const db = await getDb()
  await db.put('notes', note)
  await afterWrite()
  return note
}

export async function updateNamedNote(id: string, name: string, icon: string) {
  const db = await getDb()
  const n = await db.get('notes', id)
  if (!n) return
  await db.put('notes', { ...n, name, icon, updatedAt: nowIso() })
  await afterWrite()
}

export async function updateNoteBody(id: string, body: string) {
  const db = await getDb()
  const n = await db.get('notes', id)
  if (!n || n.body === body) return
  await db.put('notes', { ...n, body, updatedAt: nowIso() })
  await afterWrite()
}

export const dateKey = (d: Date) =>
  `${String(d.getFullYear()).padStart(4, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export async function getOrCreateDateNote(key: string): Promise<Note> {
  const db = await getDb()
  const all = await db.getAll('notes')
  const found = all.find((n) => n.kind === 'date' && n.noteDate === key && !n.isDeleted)
  if (found) return found
  const note = blankNote('date')
  note.noteDate = key
  await db.put('notes', note)
  await afterWrite()
  return note
}

// ---------------- 메모지 ↔ 노트 ----------------

export async function attachMemosToNote(noteId: string, memoIds: string[]) {
  const db = await getDb()
  const links = (await db.getAll('links')).filter((l) => l.noteId === noteId && !l.isDeleted)
  const existing = new Set(links.map((l) => l.memoId))
  let next = links.length ? Math.max(...links.map((l) => l.position)) + 1 : 0
  const now = new Date()
  for (const memoId of memoIds) {
    if (!existing.has(memoId)) {
      await db.put('links', {
        id: `${noteId}-${memoId}-${now.getTime() * 1000}`,
        noteId, memoId, position: next++, createdAt: now.toISOString(), isDeleted: false,
      })
    }
    const m = await db.get('memos', memoId)
    if (m) await db.put('memos', { ...m, inInbox: false, updatedAt: now.toISOString() })
  }
  const n = await db.get('notes', noteId)
  if (n) await db.put('notes', { ...n, updatedAt: now.toISOString() })
  await afterWrite()
}

export async function reorderMemosInNote(noteId: string, orderedMemoIds: string[]) {
  const db = await getDb()
  const links = (await db.getAll('links')).filter((l) => l.noteId === noteId && !l.isDeleted)
  const byMemo = new Map(links.map((l) => [l.memoId, l]))
  for (let i = 0; i < orderedMemoIds.length; i++) {
    const l = byMemo.get(orderedMemoIds[i])
    if (l) await db.put('links', { ...l, position: i })
  }
  const n = await db.get('notes', noteId)
  if (n) await db.put('notes', { ...n, updatedAt: nowIso() })
  await afterWrite()
}

export async function removeMemoFromNote(noteId: string, memoId: string) {
  const db = await getDb()
  const links = (await db.getAll('links')).filter((l) => l.noteId === noteId && l.memoId === memoId)
  for (const l of links) await db.put('links', { ...l, isDeleted: true })
  await afterWrite()
}

// ---------------- 동기화용 내보내기/병합 (기존 Flutter 앱과 같은 규칙) ----------------

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

function base64ToBlob(b64: string, ext: string): Blob {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`
  return new Blob([bytes], { type: mime })
}

export async function exportPayload(): Promise<SyncPayload> {
  const db = await getDb()
  const [memos, notes, links] = await Promise.all([db.getAll('memos'), db.getAll('notes'), db.getAll('links')])
  const outMemos: SyncPayload['memos'] = []
  for (const m of memos) {
    const copy: SyncPayload['memos'][number] = { ...m }
    if (m.type === 'image' && m.imageExt) {
      const img = await db.get('images', m.id)
      if (img) copy.imageData = await blobToBase64(img.blob)
    }
    outMemos.push(copy)
  }
  return { version: 1, memos: outMemos, notes, links }
}

export async function mergeRemote(remote: SyncPayload) {
  const db = await getDb()
  for (const rm of remote.memos ?? []) {
    const local = await db.get('memos', rm.id)
    if (!local || parseDate(rm.updatedAt) > parseDate(local.updatedAt)) {
      const { imageData, ...memo } = rm
      if (imageData) {
        const ext = memo.imageExt ?? 'jpg'
        await db.put('images', { id: memo.id, blob: base64ToBlob(imageData, ext), ext })
      }
      await db.put('memos', {
        ...memo,
        body: memo.body ?? '', url: memo.url ?? null, linkTitle: memo.linkTitle ?? null,
        linkDescription: memo.linkDescription ?? null, linkImageUrl: memo.linkImageUrl ?? null,
        imageExt: memo.imageExt ?? null, inInbox: memo.inInbox ?? true, isDeleted: memo.isDeleted ?? false,
      })
    }
  }
  for (const rn of remote.notes ?? []) {
    const local = await db.get('notes', rn.id)
    if (!local || parseDate(rn.updatedAt) > parseDate(local.updatedAt)) {
      await db.put('notes', {
        ...rn,
        name: rn.name ?? null, icon: rn.icon ?? null, noteDate: rn.noteDate ?? null,
        body: rn.body ?? '', isDeleted: rn.isDeleted ?? false,
      })
    }
  }
  for (const rl of remote.links ?? []) {
    const local = await db.get('links', rl.id)
    if (!local) await db.put('links', { ...rl, isDeleted: rl.isDeleted ?? false })
    else if (rl.isDeleted && !local.isDeleted) await db.put('links', { ...local, isDeleted: true })
  }
  await afterWrite(false)
}

export async function replaceAllFromPayload(p: SyncPayload) {
  await mergeRemote(p)
}
