import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Memo, Note, NoteMemoLink } from './types'

interface Schema extends DBSchema {
  memos: { key: string; value: Memo }
  notes: { key: string; value: Note }
  links: { key: string; value: NoteMemoLink }
  images: { key: string; value: { id: string; blob: Blob; ext: string } }
}

let dbp: Promise<IDBPDatabase<Schema>> | null = null

export function getDb() {
  dbp ??= openDB<Schema>('one_page_db', 1, {
    upgrade(db) {
      db.createObjectStore('memos', { keyPath: 'id' })
      db.createObjectStore('notes', { keyPath: 'id' })
      db.createObjectStore('links', { keyPath: 'id' })
      db.createObjectStore('images', { keyPath: 'id' })
    },
  })
  return dbp
}
