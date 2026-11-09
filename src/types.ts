// 기존 Flutter 앱의 Drive 백업 파일(note_app_backup.json)과 같은 필드 구성.
// 날짜는 ISO 문자열. 기존 앱은 타임존 없는 로컬 시각으로 썼으므로 읽을 때 parseDate를 쓴다.

export type MemoType = 'text' | 'link' | 'image'

export interface Memo {
  id: string
  type: MemoType
  body: string
  url: string | null
  linkTitle: string | null
  linkDescription: string | null
  linkImageUrl: string | null
  imageExt: string | null
  inInbox: boolean
  createdAt: string
  updatedAt: string
  isDeleted: boolean
}

export interface Note {
  id: string
  kind: 'named' | 'date'
  name: string | null
  icon: string | null
  noteDate: string | null // 'yyyy-MM-dd'
  body: string
  createdAt: string
  updatedAt: string
  isDeleted: boolean
}

export interface NoteMemoLink {
  id: string
  noteId: string
  memoId: string
  position: number
  createdAt: string
  isDeleted: boolean
}

export interface SyncPayload {
  version: number
  memos: (Memo & { imageData?: string })[]
  notes: Note[]
  links: NoteMemoLink[]
}

export const NOTE_ICONS: Record<string, string> = {
  work: '💼',
  idea: '💡',
  travel: '✈️',
  book: '📖',
  heart: '🤍',
  star: '⭐',
  home: '🏠',
  money: '🐷',
  health: '🌿',
  code: '💻',
}
export const DEFAULT_NOTE_ICON = 'work'
export const DATE_NOTE_ICON = '📅'

/** 'T' 뒤에 타임존이 없으면 로컬 시각(기존 앱 방식), 소수점은 3자리까지만 사용. */
export function parseDate(s: string): number {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:?\d{2})?$/.exec(s)
  if (!m) {
    const t = Date.parse(s)
    return Number.isNaN(t) ? 0 : t
  }
  const ms = (m[2] ?? '0').padEnd(3, '0').slice(0, 3)
  return Date.parse(`${m[1]}.${ms}${m[3] ?? ''}`)
}
