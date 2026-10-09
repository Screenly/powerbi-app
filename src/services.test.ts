import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { Embed } from 'powerbi-client'

GlobalRegistrator.register()

const OAUTH_SETTINGS = {
  screenly_oauth_tokens_url: 'https://api.example.com/oauth/',
  screenly_app_auth_token: 'app-auth',
}
const REPORT_EMBED_URL =
  'https://app.powerbi.com/reportEmbed?reportId=r&groupId=g'
const DASHBOARD_EMBED_URL =
  'https://app.powerbi.com/dashboardEmbed?dashboardId=d&groupId=g'
const EMBED_ERROR_EVENT = {
  detail: {
    message: 'ExplorationContainer_FailedToLoadModel_DefaultDetails',
    detailedMessage: 'This Fabric capacity is currently not available',
  },
}
const REFRESH_TIMER_ID = 42

function setupDom() {
  document.body.innerHTML = `
    <div id="embed-container"></div>
    <template id="error-template">
      <div class="error-container">
        <p class="error-message"></p>
        <table class="error-details"></table>
      </div>
    </template>
    <template id="error-row-template"></template>
  `

  const rowTemplate = document.getElementById(
    'error-row-template',
  ) as HTMLTemplateElement
  const row = document.createElement('tr')
  for (const className of ['error-key', 'error-value']) {
    const cell = document.createElement('td')
    cell.className = className
    row.appendChild(cell)
  }
  rowTemplate.content.appendChild(row)
}

const embedCalls: Array<{ config: Record<string, unknown> }> = []
const reportOn = mock(() => {})
const reportSetAccessToken = mock(async () => {})
const fakeReport = {
  on: reportOn,
  setAccessToken: reportSetAccessToken,
} as unknown as Embed
function embedFakeReport(_container: unknown, config: Record<string, unknown>) {
  embedCalls.push({ config })
  return fakeReport
}
const powerbiEmbed = mock(embedFakeReport)
const powerbiReset = mock(() => {})

Object.assign(window, {
  powerbi: { embed: powerbiEmbed, reset: powerbiReset },
})
mock.module('powerbi-client', () => ({
  models: { TokenType: { Embed: 'Embed' }, Permissions: { All: 'All' } },
}))

// setupSentry/reportError wrap Sentry (third-party) — stub to keep tests offline.
const reportError = mock(() => {})
mock.module('@screenly/edge-apps/utils', () => ({
  setupSentry: () => {},
  reportError,
}))

const { getEmbedToken, startTokenRefresh, startPowerBI, initializePowerBI } =
  await import('./services')
const { showError } = await import('./services.lib')

const signalReady = mock(() => {})
const signalAbort = mock(() => {})

function setScreenly(settings: Record<string, unknown>) {
  ;(globalThis as Record<string, unknown>).screenly = {
    settings,
    signalReadyForRendering: signalReady,
    signalAbort,
  }
}

function okFetch(token: string): typeof fetch {
  return mock(async () => ({
    ok: true,
    json: async () => ({ token }),
  })) as unknown as typeof fetch
}

function failFetch(message: string, status: number): typeof fetch {
  return mock(async () => ({
    ok: false,
    status,
    json: async () => ({ error: message }),
  })) as unknown as typeof fetch
}

function unreachableFetch(): typeof fetch {
  return mock(async () => {
    throw new TypeError('Failed to fetch')
  }) as unknown as typeof fetch
}

const originalSetTimeout = globalThis.setTimeout
const originalSetInterval = globalThis.setInterval
const originalClearInterval = globalThis.clearInterval
let timeouts: Array<{ fn: () => unknown; delayMs: number }>
let intervals: Array<{ fn: () => unknown; delayMs: number }>
const clearIntervalSpy = mock(() => {})

function flushPromises() {
  return new Promise((resolve) => originalSetTimeout(resolve, 0))
}

function firstReportedError() {
  return reportError.mock.calls[0] as unknown as [
    Error,
    Record<string, unknown>,
  ]
}

// eslint-disable-next-line max-lines-per-function
describe('services', () => {
  let originalFetch: typeof fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    reportError.mockClear()
    reportOn.mockClear()
    reportSetAccessToken.mockReset()
    reportSetAccessToken.mockImplementation(async () => {})
    powerbiEmbed.mockReset()
    powerbiEmbed.mockImplementation(embedFakeReport)
    powerbiReset.mockClear()
    signalReady.mockClear()
    signalAbort.mockClear()
    clearIntervalSpy.mockClear()
    embedCalls.length = 0
    timeouts = []
    intervals = []
    globalThis.setTimeout = ((fn: () => unknown, delayMs: number) => {
      timeouts.push({ fn, delayMs })
      return timeouts.length
    }) as unknown as typeof setTimeout
    globalThis.setInterval = ((fn: () => unknown, delayMs: number) => {
      intervals.push({ fn, delayMs })
      return REFRESH_TIMER_ID
    }) as unknown as typeof setInterval
    globalThis.clearInterval =
      clearIntervalSpy as unknown as typeof clearInterval
    setupDom()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    globalThis.setTimeout = originalSetTimeout
    globalThis.setInterval = originalSetInterval
    globalThis.clearInterval = originalClearInterval
    delete (globalThis as Record<string, unknown>).screenly
  })

  describe('getEmbedToken', () => {
    it('when embed_token setting present, should return it without fetching', async () => {
      setScreenly({ embed_token: 'static-token' })
      globalThis.fetch = mock(() => {
        throw new Error('should not fetch')
      }) as unknown as typeof fetch

      const result = await getEmbedToken()

      expect(result).toBe('static-token')
      expect(globalThis.fetch).not.toHaveBeenCalled()
    })

    it('when embed_token setting absent, should fetch token from endpoint', async () => {
      setScreenly({ ...OAUTH_SETTINGS })
      globalThis.fetch = okFetch('embed-token')

      const result = await getEmbedToken()

      expect(result).toBe('embed-token')
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.example.com/oauth/embed_token/',
        {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: 'Bearer app-auth',
          },
        },
      )
    })

    it('when response not ok with json error, should throw server message and status', async () => {
      setScreenly({ ...OAUTH_SETTINGS })
      globalThis.fetch = failFetch('PowerBI integration is not connected', 400)

      const error = await getEmbedToken().catch((thrown) => thrown)

      expect(error.message).toBe('PowerBI integration is not connected')
      expect(error.status).toBe(400)
    })

    it('when response not ok without json body, should throw default message and status', async () => {
      setScreenly({ ...OAUTH_SETTINGS })
      globalThis.fetch = mock(async () => ({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error('invalid json')
        },
      })) as unknown as typeof fetch

      const error = await getEmbedToken().catch((thrown) => thrown)

      expect(error.message).toBe('Failed to get embed token.')
      expect(error.status).toBe(500)
    })
  })

  describe('startTokenRefresh', () => {
    beforeEach(() => {
      setScreenly({ ...OAUTH_SETTINGS })
    })

    it('when started, should refresh every five minutes', () => {
      startTokenRefresh(fakeReport)

      expect(intervals[0].delayMs).toBe(300_000)
    })

    it('when interval fires, should set fresh token', async () => {
      globalThis.fetch = okFetch('new-token')
      startTokenRefresh(fakeReport)

      await intervals[0].fn()

      expect(reportSetAccessToken).toHaveBeenCalledWith('new-token')
    })

    it('when token fetch fails, should report it to sentry', async () => {
      globalThis.fetch = failFetch('boom', 500)
      startTokenRefresh(fakeReport)

      await intervals[0].fn()

      const [reportedError, context] = firstReportedError()
      expect(reportSetAccessToken).not.toHaveBeenCalled()
      expect(reportedError.message).toBe('boom')
      expect(context).toEqual({ source: 'token-refresh' })
    })

    it('when refresh fails repeatedly, should report only first failure', async () => {
      globalThis.fetch = failFetch('boom', 500)
      startTokenRefresh(fakeReport)

      await intervals[0].fn()
      await intervals[0].fn()

      expect(reportError).toHaveBeenCalledTimes(1)
    })

    it('when refresh fails again after success, should report new failure', async () => {
      startTokenRefresh(fakeReport)

      globalThis.fetch = failFetch('boom', 500)
      await intervals[0].fn()
      globalThis.fetch = okFetch('new-token')
      await intervals[0].fn()
      globalThis.fetch = failFetch('boom again', 500)
      await intervals[0].fn()

      expect(reportError).toHaveBeenCalledTimes(2)
    })

    it('when setAccessToken rejects with power bi error, should report it as error', async () => {
      globalThis.fetch = okFetch('new-token')
      reportSetAccessToken.mockImplementation(async () => {
        throw { message: 'TokenExpired', detailedMessage: 'Token expired' }
      })
      startTokenRefresh(fakeReport)

      await intervals[0].fn()

      const [reportedError, context] = firstReportedError()
      expect(reportedError).toBeInstanceOf(Error)
      expect(reportedError.message).toBe('TokenExpired')
      expect(context).toEqual({ source: 'token-refresh' })
    })

    it('when setAccessToken rejects without reason, should report fallback error', async () => {
      globalThis.fetch = okFetch('new-token')
      reportSetAccessToken.mockImplementation(async () => {
        throw undefined
      })
      startTokenRefresh(fakeReport)

      await intervals[0].fn()

      const [reportedError] = firstReportedError()
      expect(reportedError.message).toBe('Power BI embed error')
    })
  })

  describe('startPowerBI', () => {
    it('when embed throws, should report it and abort without restart', async () => {
      setScreenly({ embed_token: 'static-token', embed_url: REPORT_EMBED_URL })
      powerbiEmbed.mockImplementationOnce(() => {
        throw new Error('Invalid embed URL')
      })

      startPowerBI()
      await flushPromises()

      const [reportedError, context] = firstReportedError()
      expect(reportedError.message).toBe('Invalid embed URL')
      expect(context).toEqual({ source: 'powerbi-embed' })
      expect(signalAbort).toHaveBeenCalled()
      expect(timeouts).toEqual([])
    })
  })

  // eslint-disable-next-line max-lines-per-function
  describe('initializePowerBI', () => {
    function findReportHandler(event: string) {
      return reportOn.mock.calls.find((call) => call[0] === event)?.[1] as (
        event?: unknown,
      ) => void
    }

    it('when embedding report, should embed with token and all permissions', async () => {
      setScreenly({ embed_token: 'static-token', embed_url: REPORT_EMBED_URL })

      await initializePowerBI()

      expect(embedCalls[0].config).toMatchObject({
        accessToken: 'static-token',
        type: 'report',
        tokenType: 'Embed',
        permissions: 'All',
      })
    })

    it('when report renders, should signal ready', async () => {
      setScreenly({ embed_token: 'static-token', embed_url: REPORT_EMBED_URL })
      await initializePowerBI()

      findReportHandler('rendered')()

      expect(signalReady).toHaveBeenCalled()
    })

    it('when dashboard loads, should signal ready after one second', async () => {
      setScreenly({
        embed_token: 'static-token',
        embed_url: DASHBOARD_EMBED_URL,
      })
      await initializePowerBI()

      findReportHandler('loaded')()

      expect(timeouts).toEqual([{ fn: signalReady, delayMs: 1000 }])
    })

    it('when embedded with static token, should still start token refresh', async () => {
      setScreenly({ embed_token: 'static-token', embed_url: REPORT_EMBED_URL })

      await initializePowerBI()

      expect(intervals).toHaveLength(1)
    })

    it('when token backend rejects request, should show error and restart after one minute', async () => {
      setScreenly({ ...OAUTH_SETTINGS, embed_url: REPORT_EMBED_URL })
      globalThis.fetch = failFetch('Embed token unavailable', 403)

      await initializePowerBI()

      const [reportedError, context] = firstReportedError()
      expect(reportedError.message).toBe('Embed token unavailable')
      expect(context).toEqual({ source: 'embed-token' })
      expect(document.querySelector('.error-message')?.textContent).toBe(
        'Embed token unavailable',
      )
      expect(signalReady).toHaveBeenCalled()
      expect(signalAbort).not.toHaveBeenCalled()
      expect(timeouts).toEqual([{ fn: startPowerBI, delayMs: 60_000 }])
    })

    it.each([
      ['is unreachable', unreachableFetch()],
      ['returns 5xx', failFetch('Service unavailable', 503)],
    ])(
      'when token backend %s, should abort without error screen or restart',
      async (_description, fetchStub) => {
        setScreenly({ ...OAUTH_SETTINGS, embed_url: REPORT_EMBED_URL })
        globalThis.fetch = fetchStub

        await initializePowerBI()

        expect(signalAbort).toHaveBeenCalled()
        expect(signalReady).not.toHaveBeenCalled()
        expect(document.querySelector('.error-container')).toBeNull()
        expect(timeouts).toEqual([])
      },
    )

    it('when embed fires error, should report it and show it', async () => {
      setScreenly({ embed_token: 'static-token', embed_url: REPORT_EMBED_URL })
      await initializePowerBI()

      findReportHandler('error')(EMBED_ERROR_EVENT)

      const [reportedError, context] = firstReportedError()
      expect(reportedError.message).toBe(
        'ExplorationContainer_FailedToLoadModel_DefaultDetails',
      )
      expect(context).toEqual({
        source: 'powerbi-embed',
        detailedMessage: 'This Fabric capacity is currently not available',
        errorInfo: '[]',
      })
      expect(document.querySelector('.error-message')?.textContent).toBe(
        'This Fabric capacity is currently not available',
      )
    })

    it('when embed fires error, should remove report and stop token refresh', async () => {
      setScreenly({ ...OAUTH_SETTINGS, embed_url: REPORT_EMBED_URL })
      globalThis.fetch = okFetch('backend-token')
      await initializePowerBI()

      findReportHandler('error')(EMBED_ERROR_EVENT)

      expect(powerbiReset).toHaveBeenCalledWith(
        document.getElementById('embed-container'),
      )
      expect(clearIntervalSpy).toHaveBeenCalledWith(REFRESH_TIMER_ID)
    })

    it('when embed fires error, should embed again after one minute', async () => {
      setScreenly({ embed_token: 'static-token', embed_url: REPORT_EMBED_URL })
      await initializePowerBI()
      findReportHandler('error')(EMBED_ERROR_EVENT)

      expect(timeouts).toEqual([{ fn: startPowerBI, delayMs: 60_000 }])
      timeouts[0].fn()
      await flushPromises()

      expect(embedCalls).toHaveLength(2)
    })
  })
})

describe('services.lib', () => {
  describe('showError', () => {
    beforeEach(() => {
      setScreenly({})
      signalReady.mockClear()
      setupDom()
    })

    afterEach(() => {
      delete (globalThis as Record<string, unknown>).screenly
    })

    it('when given message and error info, should render them and signal ready', () => {
      showError({
        detailedMessage: 'Unable to load report',
        technicalDetails: { errorInfo: [{ key: 'status', value: 403 }] },
      })

      expect(document.querySelector('.error-message')?.textContent).toBe(
        'Unable to load report',
      )
      expect(document.querySelector('.error-key')?.textContent).toBe('status')
      expect(document.querySelector('.error-value')?.textContent).toBe('403')
      expect(signalReady).toHaveBeenCalled()
    })

    it('when only message present, should render message', () => {
      showError({ message: 'X_FailedToLoadModel_Y' })

      expect(document.querySelector('.error-message')?.textContent).toBe(
        'X_FailedToLoadModel_Y',
      )
    })
  })
})
