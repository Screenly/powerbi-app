import '@screenly/edge-apps'

declare module '@screenly/edge-apps' {
  interface ScreenlyObject {
    signalAbort: () => void
  }

  interface ScreenlySettings {
    embed_token?: string
    embed_url: string
    display_errors: string
    screenly_oauth_tokens_url: string
    screenly_app_auth_token: string
  }
}
