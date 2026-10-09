import { describe, it, expect } from 'bun:test'
import { getEmbedTypeFromUrl } from './utils'

describe('utils', () => {
  describe('getEmbedTypeFromUrl', () => {
    it('when url is dashboard embed, should return dashboard', () => {
      expect(
        getEmbedTypeFromUrl(
          'https://app.powerbi.com/dashboardEmbed?dashboardId=abc&groupId=def',
        ),
      ).toBe('dashboard')
    })

    it('when url is report embed, should return report', () => {
      expect(
        getEmbedTypeFromUrl(
          'https://app.powerbi.com/reportEmbed?reportId=abc&groupId=def',
        ),
      ).toBe('report')
    })
  })
})
