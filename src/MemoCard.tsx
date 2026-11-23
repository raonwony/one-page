import { useEffect, useState, type ReactNode } from 'react'
import { relativeTime, hostOf } from './format'
import { Icon } from './Icons'
import { getImageBlob } from './store'
import type { Memo } from './types'

function MemoImage({ id }: { id: string }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let url: string | null = null
    let alive = true
    getImageBlob(id).then((b) => {
      if (!alive || !b) return
      url = URL.createObjectURL(b)
      setSrc(url)
    })
    return () => {
      alive = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [id])
  return src ? <img className="memo-img" src={src} alt="" /> : <div className="memo-img placeholder"><Icon name="image" /></div>
}

export function MemoCard(props: {
  memo: Memo
  selected?: boolean | null
  onTap?: () => void
  onEdit?: () => void
  onDelete?: () => void
  trailing?: ReactNode
}) {
  const { memo, selected, onTap, onEdit, onDelete, trailing } = props
  const canEdit = !!onEdit
  // 글을 꾹 눌러 범위를 잡거나 드래그로 선택한 직후에는 카드가 선택(체크)되지 않게 한다.
  const handleClick = () => {
    if (window.getSelection()?.toString()) return
    onTap?.()
  }

  return (
    <div
      className={'card memo' + (selected ? ' selected' : '')}
      onClick={handleClick}
    >
      {selected !== null && selected !== undefined && (
        <span className={'dot' + (selected ? ' on' : '')}>{selected && <Icon name="check" size={14} />}</span>
      )}
      <div className="memo-body">
        {memo.type === 'link' && (
          <>
            <div className="memo-host"><Icon name="link" size={14} /> {hostOf(memo.url ?? '')}</div>
            <div className="memo-text">{memo.linkTitle ?? memo.url}</div>
          </>
        )}
        {memo.type === 'text' && <div className="memo-text clamp">{memo.body || '(빈 메모)'}</div>}
        {memo.type === 'image' && (
          <>
            {memo.body && <div className="memo-text clamp caption">{memo.body}</div>}
            <MemoImage id={memo.id} />
          </>
        )}
        <div className="memo-meta">
          <span>{relativeTime(memo.createdAt)}</span>
          {memo.type === 'link' && memo.url && (
            <a href={memo.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} aria-label="링크 열기">
              <Icon name="external" size={17} />
            </a>
          )}
        </div>
      </div>
      {canEdit && (
        <button className="icon-btn" aria-label="수정" onClick={(e) => { e.stopPropagation(); onEdit?.() }}>
          <Icon name="edit" size={18} />
        </button>
      )}
      {onDelete && (
        <button className="icon-btn" aria-label="삭제" onClick={(e) => { e.stopPropagation(); onDelete() }}>
          <Icon name="trash" size={18} />
        </button>
      )}
      {trailing}
    </div>
  )
}
