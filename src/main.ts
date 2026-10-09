import './css/style.css'
import panic from 'panic-overlay'
import { setupSentry } from '@screenly/edge-apps/utils'
import { startPowerBI } from './services'

setupSentry('powerbi', { powerbi: { embed_url: screenly.settings.embed_url } })

panic.configure({
  handleErrors: screenly.settings.display_errors === 'true',
})
if (screenly.settings.display_errors === 'true') {
  window.addEventListener('error', screenly.signalReadyForRendering)
  window.addEventListener(
    'unhandledrejection',
    screenly.signalReadyForRendering,
  )
}

// powerbi-client's DOM 'error' event bubbles to window, where Sentry would capture it a second time.
const container = document.getElementById('embed-container') as HTMLElement
container.addEventListener('error', (event) => event.stopPropagation())

startPowerBI()
