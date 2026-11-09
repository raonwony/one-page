import { useEffect, useRef, useState } from 'react'
import { getSyncState, sync } from './drive'
import { Icon } from './Icons'
import { MemoCard } from './MemoCard'
import { Sheet } from './Sheet'
import {
  allMemos, attachMemosToNote, createCaptured, createNamedNote,
  memosOfNote, namedNotes, updateMemoText, updateNamedNote, useStore, dateNotes,
} from './store'
import { DATE_NOTE_ICON, DEFAULT_NOTE_ICON, NOTE_ICONS, type Memo, type Note } from './types'
import { koreanDate } from './format'

const IMAGE_EXTS: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/bmp': 'bmp', 'image/heic': 'heic',
}

// ---------------- 빠른 메모 ----------------

interface Pending { key: string; blob: Blob; ext: string; url: string }

export function CaptureSheet({ editing, onClose, onSaved }: { editing?: Memo; onClose: () => void; onSaved?: (msg: string) => void }) {
  const init = editing ? (editing.type === 'link' ? editing.url ?? '' : editing.body) : ''
  const [text, setText] = useState(init)
  const [images, setImages] = useState<Pending[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const imagesRef = useRef<Pending[]>([])
  imagesRef.current = images
  useEffect(() => { ref.current?.focus() }, [])
  // 시트가 닫힐 때 미리보기 주소를 정리한다.
  useEffect(() => () => imagesRef.current.forEach((i) => URL.revokeObjectURL(i.url)), [])

  function addImages(blobs: Blob[]) {
    setError(null)
    setImages((prev) => [
      ...prev,
      ...blobs.map((blob) => ({
        key: crypto.randomUUID(), blob, ext: IMAGE_EXTS[blob.type] ?? 'png', url: URL.createObjectURL(blob),
      })),
    ])
  }

  function removeImage(key: string) {
    setImages((prev) => {
      prev.filter((i) => i.key === key).forEach((i) => URL.revokeObjectURL(i.url))
      return prev.filter((i) => i.key !== key)
    })
  }

  const canSave = !busy && (text.trim().length > 0 || images.length > 0)

  async function save() {
    if (!canSave) return
    setBusy(true)
    try {
      if (editing) {
        await updateMemoText(editing.id, text.trim())
        onSaved?.('수정했어요')
      } else {
        await createCaptured(text, images.map(({ blob, ext }) => ({ blob, ext })))
        onSaved?.(images.length ? `글·사진을 받은함에 저장했어요` : '받은함에 저장했어요')
        // 로그인이 풀려 있으면, 저장 버튼을 누른 이 순간에 바로 다시 연결해서 올린다.
        if (getSyncState().kind === 'needsAuth') void sync(true)
      }
      onClose()
    } catch (e) {
      setBusy(false)
      setError(`저장하지 못했어요: ${e instanceof Error ? e.message : e}`)
    }
  }

  async function pasteFromClipboard() {
    setError(null)
    try {
      const items = await navigator.clipboard.read()
      const blobs: Blob[] = []
      for (const item of items) {
        const type = item.types.find((t) => t.startsWith('image/'))
        if (type) blobs.push(await item.getType(type))
      }
      if (blobs.length) addImages(blobs)
      else setError('클립보드에 이미지가 없어요')
    } catch {
      setError('클립보드를 읽지 못했어요. 입력창에 직접 붙여넣거나 사진 버튼을 써 주세요.')
    }
  }

  return (
    <Sheet onClose={onClose}>
      <textarea
        ref={ref}
        className="input"
        rows={5}
        value={text}
        placeholder="무엇이든 적어보세요. 링크를 붙여넣으면 자동으로 정리돼요."
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void save() }}
        onPaste={(e) => {
          if (editing) return
          const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'))
          if (files.length) { e.preventDefault(); addImages(files) }
        }}
      />
      {images.length > 0 && (
        <div className="thumbs">
          {images.map((i) => (
            <div key={i.key} className="thumb">
              <img src={i.url} alt="" />
              <button aria-label="사진 빼기" onClick={() => removeImage(i.key)}><Icon name="x" size={14} /></button>
            </div>
          ))}
        </div>
      )}
      {error && <p className="hint error">{error}</p>}
      <div className="row">
        {!editing && (
          <>
            <button className="icon-btn" aria-label="클립보드 이미지 붙여넣기" onClick={pasteFromClipboard}><Icon name="paste" /></button>
            <button className="icon-btn" aria-label="사진 고르기" onClick={() => fileRef.current?.click()}><Icon name="image" /></button>
            <input ref={fileRef} type="file" accept="image/*" multiple hidden
              onChange={(e) => { addImages(Array.from(e.target.files ?? [])); e.target.value = '' }} />
          </>
        )}
        <span className="grow" />
        <button className="btn primary" disabled={!canSave} onClick={save}>
          <Icon name="check" size={18} /> {editing ? '저장' : '받은함에 저장'}
        </button>
      </div>
      {!editing && <p className="hint">Ctrl/⌘ + Enter로 저장{images.length > 0 && ' · 글과 사진은 각각 메모지로 저장돼요'}</p>}
    </Sheet>
  )
}

// ---------------- 노트 만들기 / 수정 ----------------

export function NoteFormSheet({ editing, onClose, onDone }: { editing?: Note; onClose: () => void; onDone?: (n: Note) => void }) {
  const [name, setName] = useState(editing?.name ?? '')
  const [icon, setIcon] = useState(editing?.icon ?? DEFAULT_NOTE_ICON)
  async function save() {
    const n = name.trim()
    if (!n) return
    if (editing) { await updateNamedNote(editing.id, n, icon); onClose(); return }
    const note = await createNamedNote(n, icon)
    onDone?.(note)
    onClose()
  }
  return (
    <Sheet onClose={onClose}>
      <h3>{editing ? '노트 수정' : '새 노트'}</h3>
      <input className="input" autoFocus value={name} placeholder="노트 이름" onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') void save() }} />
      <div className="icon-grid">
        {Object.entries(NOTE_ICONS).map(([key, glyph]) => (
          <button key={key} className={'icon-choice' + (icon === key ? ' on' : '')} onClick={() => setIcon(key)} aria-label={key}>{glyph}</button>
        ))}
      </div>
      <div className="row">
        <span className="grow" />
        <button className="btn primary" disabled={!name.trim()} onClick={save}>{editing ? '저장' : '만들기'}</button>
      </div>
    </Sheet>
  )
}

// ---------------- 선택한 메모지를 노트에 붙이기 ----------------

export function AttachSheet({ memoIds, onClose, onAttached }: { memoIds: string[]; onClose: () => void; onAttached: (note: Note) => void }) {
  const s = useStore()
  const [creating, setCreating] = useState(false)
  async function attach(note: Note) {
    await attachMemosToNote(note.id, memoIds)
    onAttached(note)
    onClose()
  }
  if (creating) return <NoteFormSheet onClose={() => setCreating(false)} onDone={(n) => void attach(n)} />
  return (
    <Sheet onClose={onClose}>
      <h3>어느 노트에 붙일까요?</h3>
      <div className="list">
        {namedNotes(s).map((n) => (
          <button key={n.id} className="list-item" onClick={() => void attach(n)}>
            <span className="avatar">{NOTE_ICONS[n.icon ?? ''] ?? NOTE_ICONS[DEFAULT_NOTE_ICON]}</span>{n.name}
          </button>
        ))}
        {dateNotes(s).slice(0, 5).map((n) => (
          <button key={n.id} className="list-item" onClick={() => void attach(n)}>
            <span className="avatar">{DATE_NOTE_ICON}</span>{koreanDate(n.noteDate)}
          </button>
        ))}
        <button className="list-item accent" onClick={() => setCreating(true)}>
          <span className="avatar"><Icon name="plus" size={18} /></span>새 노트 만들기
        </button>
      </div>
    </Sheet>
  )
}

// ---------------- 이미 있는 메모지를 노트에 추가 ----------------

export function AddExistingSheet({ noteId, onClose }: { noteId: string; onClose: () => void }) {
  const s = useStore()
  const inNote = new Set(memosOfNote(s, noteId).map((m) => m.id))
  const candidates = allMemos(s).filter((m) => !inNote.has(m.id))
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  return (
    <Sheet onClose={onClose}>
      <h3>메모지 추가</h3>
      <div className="stack scroll">
        {candidates.length === 0 && <p className="hint">추가할 수 있는 메모지가 없어요.</p>}
        {candidates.map((m) => <MemoCard key={m.id} memo={m} selected={picked.has(m.id)} onTap={() => toggle(m.id)} />)}
      </div>
      <div className="row">
        <span className="grow" />
        <button className="btn primary" disabled={picked.size === 0}
          onClick={async () => { await attachMemosToNote(noteId, [...picked]); onClose() }}>
          {picked.size}개 붙이기
        </button>
      </div>
    </Sheet>
  )
}

// ---------------- 삭제 확인 ----------------

export function ConfirmSheet({ title, body, confirmLabel, onConfirm, onClose }: { title: string; body?: string; confirmLabel: string; onConfirm: () => void; onClose: () => void }) {
  return (
    <Sheet onClose={onClose}>
      <h3>{title}</h3>
      {body && <p className="hint">{body}</p>}
      <div className="row">
        <span className="grow" />
        <button className="btn" onClick={onClose}>취소</button>
        <button className="btn danger" onClick={() => { onConfirm(); onClose() }}>{confirmLabel}</button>
      </div>
    </Sheet>
  )
}
