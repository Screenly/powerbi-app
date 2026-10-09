import type { PowerBiError, PowerBiErrorInfo } from './services.types'

export const DASHBOARD_READY_DELAY_MS = 1000

export const TOKEN_REFRESH_INTERVAL_MS = 5 * 60_000
export const RESTART_DELAY_MS = 60_000

const REPORTABLE_FALLBACK_MESSAGE = 'Power BI embed error'
const DEFAULT_ERROR_MESSAGE = 'Unable to load report'

// Build a real Error (so Sentry groups/titles it instead of "Object captured as exception").
export function toReportableError(
  error: PowerBiError | Error | undefined,
): Error {
  if (error instanceof Error) {
    return error
  }

  if (!error) {
    return new Error(REPORTABLE_FALLBACK_MESSAGE)
  }

  if (error.message) {
    return new Error(error.message)
  }

  if (error.detailedMessage) {
    return new Error(error.detailedMessage)
  }

  return new Error(REPORTABLE_FALLBACK_MESSAGE)
}

function getErrorInfo(error: PowerBiError): PowerBiErrorInfo[] {
  if (!error.technicalDetails || !error.technicalDetails.errorInfo) {
    return []
  }

  return error.technicalDetails.errorInfo
}

function getDisplayMessage(error: PowerBiError): string {
  if (error.detailedMessage) {
    return error.detailedMessage
  }

  if (error.message) {
    return error.message
  }

  return DEFAULT_ERROR_MESSAGE
}

// Flatten errorInfo to a string so Sentry's normalizeDepth doesn't truncate the nested
// array to "[Array]".
export function powerBiErrorContext(
  error: PowerBiError,
): Record<string, unknown> {
  return {
    source: 'powerbi-embed',
    detailedMessage: error.detailedMessage,
    errorInfo: JSON.stringify(getErrorInfo(error)),
  }
}

export function showError(error: PowerBiError): void {
  if (screenly.settings.display_errors === 'false') {
    screenly.signalAbort()
    return
  }

  const container = document.getElementById('embed-container') as HTMLElement
  container.innerHTML = ''

  const template = document.getElementById(
    'error-template',
  ) as HTMLTemplateElement
  const content = template.content.cloneNode(true) as DocumentFragment

  const messageEl = content.querySelector('.error-message') as HTMLElement
  messageEl.textContent = getDisplayMessage(error)

  const table = content.querySelector('.error-details') as HTMLElement
  const rowTemplate = document.getElementById(
    'error-row-template',
  ) as HTMLTemplateElement
  getErrorInfo(error).forEach(function (item) {
    const row = rowTemplate.content.cloneNode(true) as DocumentFragment
    ;(row.querySelector('.error-key') as HTMLElement).textContent = item.key
    ;(row.querySelector('.error-value') as HTMLElement).textContent = String(
      item.value,
    )
    table.appendChild(row)
  })

  container.appendChild(content)
  screenly.signalReadyForRendering()
}
