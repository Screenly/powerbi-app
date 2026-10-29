import { models, type Embed } from 'powerbi-client'
import { reportError } from '@screenly/edge-apps/utils'
import { getEmbedTypeFromUrl } from './utils'
import {
  DASHBOARD_READY_DELAY_MS,
  RESTART_DELAY_MS,
  TOKEN_REFRESH_INTERVAL_MS,
  powerBiErrorContext,
  showError,
  toReportableError,
} from './services.lib'
import type { PowerBiError } from './services.types'

export async function getEmbedToken(): Promise<string> {
  if (screenly.settings.embed_token) {
    return screenly.settings.embed_token
  }

  const response = await fetch(
    screenly.settings.screenly_oauth_tokens_url + 'embed_token/',
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${screenly.settings.screenly_app_auth_token}`,
      },
    },
  )

  if (!response.ok) {
    let detailedMessage: string
    try {
      detailedMessage = (await response.json())['error']
    } catch {
      detailedMessage = `Failed to get embed token.`
    }

    const error = new Error(detailedMessage) as Error & { status: number }
    error.status = response.status
    throw error
  }

  const { token } = await response.json()
  return token
}

export function startTokenRefresh(
  report: Embed,
): ReturnType<typeof setInterval> {
  let hasReportedFailure = false

  return setInterval(async () => {
    try {
      const token = await getEmbedToken()
      await report.setAccessToken(token)
      hasReportedFailure = false
    } catch (error) {
      if (hasReportedFailure) {
        return
      }

      hasReportedFailure = true
      reportError(
        toReportableError(error as PowerBiError | Error | undefined),
        {
          source: 'token-refresh',
        },
      )
    }
  }, TOKEN_REFRESH_INTERVAL_MS)
}

function scheduleRestart() {
  setTimeout(startPowerBI, RESTART_DELAY_MS)
}

export function startPowerBI(): void {
  initializePowerBI().catch((error) => {
    reportError(toReportableError(error), { source: 'powerbi-embed' })
    screenly.signalAbort()
  })
}

export async function initializePowerBI(): Promise<void> {
  const embedUrl = screenly.settings.embed_url
  const resourceType = getEmbedTypeFromUrl(embedUrl)

  let token: string
  try {
    token = await getEmbedToken()
  } catch (error) {
    reportError(error, { source: 'embed-token' })

    const failure = error as Error & { status?: number }
    if (failure.status === undefined || failure.status >= 500) {
      screenly.signalAbort()
      return
    }

    showError({
      detailedMessage: failure.message,
      technicalDetails: {
        errorInfo: [{ key: 'status', value: failure.status }],
      },
    })
    scheduleRestart()
    return
  }

  const container = document.getElementById('embed-container') as HTMLElement
  const report = window.powerbi.embed(container, {
    embedUrl: embedUrl,
    accessToken: token,
    type: resourceType,
    tokenType: models.TokenType.Embed,
    permissions: models.Permissions.All,
    settings: {
      filterPaneEnabled: false,
      navContentPaneEnabled: false,
      hideErrors: true,
    },
  })

  const refreshTimer = startTokenRefresh(report)

  let dashboardReadyTimer: ReturnType<typeof setTimeout> | undefined
  if (resourceType === 'report') {
    report.on('rendered', () => screenly.signalReadyForRendering())
  } else {
    report.on('loaded', () => {
      dashboardReadyTimer = setTimeout(
        screenly.signalReadyForRendering,
        DASHBOARD_READY_DELAY_MS,
      )
    })
  }

  report.on('error', (event) => {
    const detail = event.detail as PowerBiError
    reportError(toReportableError(detail), powerBiErrorContext(detail))
    clearTimeout(dashboardReadyTimer)
    clearInterval(refreshTimer)
    window.powerbi.reset(container)
    showError(detail)
    scheduleRestart()
  })
}
