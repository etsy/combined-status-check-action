import {encodeMetadata, decodeMetadata} from './check-run-manager'
import {CheckRunMetadata} from '../utils/types'

describe('encodeMetadata and decodeMetadata', () => {
  it('encodes and decodes required-check-runs metadata', () => {
    const metadata: CheckRunMetadata = {
      startTime: 1706284800000,
      timeoutSeconds: 300,
      mode: 'required-check-runs',
      requiredChecks: ['build', 'test', 'lint']
    }

    const encoded = encodeMetadata(metadata)
    const decoded = decodeMetadata(encoded)

    expect(decoded).toEqual(metadata)
  })

  it('encodes and decodes regex mode metadata', () => {
    const metadata: CheckRunMetadata = {
      startTime: 1706284800000,
      timeoutSeconds: 600,
      mode: 'regex',
      statusRegex: '^ci-.*$',
      checkRunRegex: '^build-.*$'
    }

    const encoded = encodeMetadata(metadata)
    const decoded = decodeMetadata(encoded)

    expect(decoded).toEqual(metadata)
  })

  it('returns null for null input', () => {
    expect(decodeMetadata(null)).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(decodeMetadata('')).toBeNull()
  })

  it('returns null for text without metadata marker', () => {
    expect(decodeMetadata('Some random text without metadata')).toBeNull()
  })

  it('returns null for invalid JSON in metadata', () => {
    const invalidMetadata =
      '<!-- combined-status-check-metadata:{invalid json}:metadata-end -->'
    expect(decodeMetadata(invalidMetadata)).toBeNull()
  })

  it('extracts metadata from text with other content', () => {
    const metadata: CheckRunMetadata = {
      startTime: 1706284800000,
      timeoutSeconds: 300,
      mode: 'required-check-runs',
      requiredChecks: ['build']
    }

    const textWithMetadata = `
Some header text

${encodeMetadata(metadata)}

Some footer text
`

    const decoded = decodeMetadata(textWithMetadata)
    expect(decoded).toEqual(metadata)
  })
})
