// 기존 Flutter 앱에서 쓰던 "웹 애플리케이션" 타입 OAuth 클라이언트 ID.
// 같은 구글 클라우드 프로젝트이므로 Drive 숨김 저장 공간(appDataFolder)의 기존 백업을 그대로 읽을 수 있다.
// 다른 클라이언트 ID를 쓰려면 빌드 시 VITE_GOOGLE_CLIENT_ID 환경변수로 덮어쓴다.
export const GOOGLE_CLIENT_ID: string =
  (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ??
  '352345649881-575nkkmg0jtouieem3ugtb4lrndtcf8h.apps.googleusercontent.com'

export const BACKUP_FILE_NAME = 'note_app_backup.json'
