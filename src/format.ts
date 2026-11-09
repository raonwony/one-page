import { parseDate } from './types'

export function relativeTime(iso: string): string {
  const diff = Date.now() - parseDate(iso)
  const min = Math.floor(diff / 60000)
  if (min < 1) return '방금'
  if (min < 60) return `${min}분 전`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}시간 전`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}일 전`
  const d = new Date(parseDate(iso))
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
}

export function hostOf(url: string): string {
  try { return new URL(url).host } catch { return url }
}

export function koreanDate(key: string | null): string {
  const p = (key ?? '').split('-')
  if (p.length !== 3) return key ?? ''
  return `${p[0]}년 ${Number(p[1])}월 ${Number(p[2])}일`
}
