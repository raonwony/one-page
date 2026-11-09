import { useEffect, useRef, useState } from 'react'
import { koreanDate } from './format'
import { Icon } from './Icons'
import { MemoCard } from './MemoCard'
import { AddExistingSheet, AttachSheet, CaptureSheet, ConfirmSheet, NoteFormSheet } from './Sheets'
import {
  dateKey, dateNotes, deleteMemo, getOrCreateDateNote, inboxMemos, memosOfNote, namedNotes,
  removeMemoFromNote, reorderMemosInNote, updateNoteBody, useStore,
} from './store'
import { DATE_NOTE_ICON, DEFAULT_NOTE_ICON, NOTE_ICONS, type Memo, type Note } from './types'

// ---------------- 받은함 ----------------

export function InboxScreen({ openNote, toast }: { openNote: (id: string) => void; toast: (m: string) => void }) {
  const s = useStore()
  const memos = inboxMemos(s)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<Memo | null>(null)
  const [deleting, setDeleting] = useState<Memo | null>(null)
  const [attaching, setAttaching] = useState(false)
  const has = selected.size > 0
  const toggle = (id: string) => setSelected((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })

  return (
    <>
      <header className="appbar">
        {has && <button className="icon-btn" onClick={() => setSelected(new Set())} aria-label="선택 해제"><Icon name="x" /></button>}
        <h1>{has ? `${selected.size}개 선택됨` : '받은함'}</h1>
      </header>
      <div className="content stack">
        {memos.length === 0 && (
          <div className="empty"><Icon name="inbox" size={48} /><p>받은함이 비어 있어요.<br />오른쪽 아래 버튼으로 생각을 적어보세요.</p></div>
        )}
        {memos.map((m) => (
          <MemoCard key={m.id} memo={m} selected={has ? selected.has(m.id) : null}
            onTap={() => toggle(m.id)} onLongPress={() => setDeleting(m)}
            onEdit={has ? undefined : () => setEditing(m)} />
        ))}
      </div>
      {has && (
        <div className="bottom-action">
          <button className="btn primary wide" onClick={() => setAttaching(true)}><Icon name="pin" size={18} /> 노트에 붙이기 ({selected.size})</button>
        </div>
      )}
      {editing && <CaptureSheet editing={editing} onClose={() => setEditing(null)} onSaved={toast} />}
      {deleting && <ConfirmSheet title="메모지를 삭제할까요?" body="삭제하면 되돌릴 수 없어요." confirmLabel="삭제"
        onConfirm={() => void deleteMemo(deleting.id)} onClose={() => setDeleting(null)} />}
      {attaching && <AttachSheet memoIds={[...selected]} onClose={() => setAttaching(false)}
        onAttached={(n) => { setSelected(new Set()); openNote(n.id) }} />}
    </>
  )
}

// ---------------- 노트 목록 ----------------

export function NoteListScreen({ openNote }: { openNote: (id: string) => void }) {
  const s = useStore()
  const [menu, setMenu] = useState(false)
  const [creating, setCreating] = useState(false)
  const [picking, setPicking] = useState(false)
  const dateRef = useRef<HTMLInputElement>(null)

  async function openDate(key: string) {
    const n = await getOrCreateDateNote(key)
    openNote(n.id)
  }

  const tile = (n: Note) => (
    <button key={n.id} className="card list-item" onClick={() => openNote(n.id)}>
      <span className="avatar">{n.kind === 'date' ? DATE_NOTE_ICON : NOTE_ICONS[n.icon ?? ''] ?? NOTE_ICONS[DEFAULT_NOTE_ICON]}</span>
      <span className="grow-text">
        <span className="title">{n.kind === 'date' ? koreanDate(n.noteDate) : n.name}</span>
        {n.body && <span className="sub">{n.body}</span>}
      </span>
    </button>
  )

  const named = namedNotes(s)
  const dates = dateNotes(s)
  return (
    <>
      <header className="appbar">
        <h1>노트</h1>
        <span className="grow" />
        <button className="icon-btn" aria-label="노트 만들기" onClick={() => setMenu(true)}><Icon name="plus" /></button>
      </header>
      <div className="content">
        <h2>이름 있는 노트</h2>
        {named.length === 0 ? <p className="hint">아직 만든 노트가 없어요.</p> : <div className="stack">{named.map(tile)}</div>}
        <h2>날짜 노트</h2>
        {dates.length === 0 ? <p className="hint">아직 날짜 노트가 없어요.</p> : <div className="stack">{dates.map(tile)}</div>}
      </div>
      {menu && (
        <div className="sheet-backdrop" onClick={() => setMenu(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <button className="list-item" onClick={() => { setMenu(false); setCreating(true) }}><Icon name="edit" /> 이름 있는 노트 만들기</button>
            <button className="list-item" onClick={() => { setMenu(false); void openDate(dateKey(new Date())) }}><Icon name="calendar" /> 오늘 날짜 노트 만들기</button>
            <button className="list-item" onClick={() => { setMenu(false); setPicking(true) }}><Icon name="calendar" /> 날짜 선택해서 노트 만들기</button>
          </div>
        </div>
      )}
      {creating && <NoteFormSheet onClose={() => setCreating(false)} onDone={(n) => openNote(n.id)} />}
      {picking && (
        <div className="sheet-backdrop" onClick={() => setPicking(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h3>날짜 선택</h3>
            <input ref={dateRef} type="date" className="input" defaultValue={dateKey(new Date())} />
            <div className="row"><span className="grow" />
              <button className="btn primary" onClick={() => { const v = dateRef.current?.value; setPicking(false); if (v) void openDate(v) }}>열기</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ---------------- 노트 상세 ----------------

/** 본문 편집 칸. 처음부터 저장된 본문으로 시작하고, 입력 0.5초 뒤 / 화면을 나갈 때 저장한다. */
function NoteBody({ note }: { note: Note }) {
  const [body, setBody] = useState(note.body)
  const timer = useRef<number | undefined>(undefined)
  const latest = useRef(note.body)
  const noteId = note.id

  useEffect(() => () => {
    window.clearTimeout(timer.current)
    void updateNoteBody(noteId, latest.current)
  }, [noteId])

  function onBody(v: string) {
    setBody(v)
    latest.current = v
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void updateNoteBody(noteId, v), 500)
  }
  return <textarea className="note-body" value={body} placeholder="이 노트에 직접 적어보세요." onChange={(e) => onBody(e.target.value)} />
}

export function NoteDetailScreen({ noteId, back, toast }: { noteId: string; back: () => void; toast: (m: string) => void }) {
  const s = useStore()
  const note = s.notes.find((n) => n.id === noteId)
  const memos = memosOfNote(s, noteId)
  const [adding, setAdding] = useState(false)
  const [editingNote, setEditingNote] = useState(false)
  const [editingMemo, setEditingMemo] = useState<Memo | null>(null)

  function move(i: number, d: -1 | 1) {
    const ids = memos.map((m) => m.id)
    const j = i + d
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    void reorderMemosInNote(noteId, ids)
  }

  const title = !note ? '노트' : note.kind === 'date' ? koreanDate(note.noteDate) : note.name ?? '노트'
  return (
    <>
      <header className="appbar">
        <button className="icon-btn" onClick={back} aria-label="뒤로"><Icon name="back" /></button>
        <h1>{title}</h1>
        <span className="grow" />
        {note?.kind === 'named' && <button className="icon-btn" aria-label="이름·아이콘 수정" onClick={() => setEditingNote(true)}><Icon name="edit" /></button>}
      </header>
      <div className="content">
        {note && <NoteBody key={note.id} note={note} />}
        <h2>붙인 메모지</h2>
        {memos.length === 0 && <p className="hint">아직 붙은 메모지가 없어요.</p>}
        <div className="stack">
          {memos.map((m, i) => (
            <MemoCard key={m.id} memo={m} onEdit={() => setEditingMemo(m)}
              trailing={
                <div className="memo-actions">
                  <button className="icon-btn" aria-label="위로" disabled={i === 0} onClick={() => move(i, -1)}><Icon name="up" size={18} /></button>
                  <button className="icon-btn" aria-label="아래로" disabled={i === memos.length - 1} onClick={() => move(i, 1)}><Icon name="down" size={18} /></button>
                  <button className="icon-btn" aria-label="노트에서 빼기" onClick={() => void removeMemoFromNote(noteId, m.id)}><Icon name="x" size={18} /></button>
                </div>
              } />
          ))}
        </div>
      </div>
      <button className="fab" aria-label="메모지 추가" onClick={() => setAdding(true)}><Icon name="plus" size={26} /></button>
      {adding && <AddExistingSheet noteId={noteId} onClose={() => setAdding(false)} />}
      {editingNote && note && <NoteFormSheet editing={note} onClose={() => setEditingNote(false)} />}
      {editingMemo && <CaptureSheet editing={editingMemo} onClose={() => setEditingMemo(null)} onSaved={toast} />}
    </>
  )
}
