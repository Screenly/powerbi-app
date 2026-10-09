import '@screenly/edge-apps'

declare module '@screenly/edge-apps' {
  interface ScreenlyObject {
    signalAbort: () => void
  }

  interface ScreenlySettings {
    embed_token?: string
    embed_url: string
    display_backtraces?: string
    display_error_messages?: string
    screenly_oauth_tokens_url: string
    screenly_app_auth_token: string
  }
}
