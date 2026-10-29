import { Segment } from '../types'
import { apiUrl } from '../config'

const VERIFY_TIMEOUT_MS = 10000
const VERIFY_MAX_ATTEMPTS = 3
const VERIFY_RETRY_DELAY_MS = 1200
const RETRYABLE_STATUSES = new Set([502, 503, 504])

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function isTimeoutOrNetworkError(error: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true
  if (typeof error === 'object' && error !== null && (error as { name?: string }).name === 'AbortError') {
    return true
  }
  const message = String(
    (error as { message?: string } | undefined)?.message || error || ''
  ).toLowerCase()
  return [
    'aborted',
    'abort',
    'timeout',
    'timed out',
    'failed to fetch',
    'networkerror',
    'network error',
    'load failed',
    'fetch failed',
    'err_internet_disconnected',
    'err_network_changed',
    'sin conexión',
    'sin conexion'
  ].some((fragment) => message.includes(fragment))
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = VERIFY_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController()
  const externalSignal = init.signal
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  const onExternalAbort = () => controller.abort()

  if (externalSignal) {
    if (externalSignal.aborted) controller.abort()
    else externalSignal.addEventListener('abort', onExternalAbort)
  }

  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeoutId)
    externalSignal?.removeEventListener('abort', onExternalAbort)
  }
}

export async function fetchWithRetry(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: { attempts?: number, timeoutMs?: number, retryDelayMs?: number } = {}
): Promise<Response> {
  const attempts = options.attempts ?? VERIFY_MAX_ATTEMPTS
  const timeoutMs = options.timeoutMs ?? VERIFY_TIMEOUT_MS
  const retryDelayMs = options.retryDelayMs ?? VERIFY_RETRY_DELAY_MS

  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetchWithTimeout(input, init, timeoutMs)
      if (attempt < attempts && RETRYABLE_STATUSES.has(response.status)) {
        try {
          await response.body?.cancel()
        } catch {
          // ignore
        }
        await delay(retryDelayMs * attempt)
        continue
      }
      return response
    } catch (error) {
      lastError = error
      if (attempt < attempts) {
        await delay(retryDelayMs * attempt)
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Error de red al verificar la descarga')
}

function parseContentLength(value: string | null): bigint {
  if (!value) return BigInt(0)
  const match = value.match(/\d+/)
  if (!match) return BigInt(0)
  try {
    return BigInt(match[0])
  } catch {
    return BigInt(0)
  }
}

export class HttpSegmentEngine {
  private speedSamples: Array<{ bytes: number, time: number }> = []
  private partialSegments = new Map<string, Uint8Array>()

  private getSegmentKey(url: string, segment: Segment): string {
    return `${url}|${segment.index}|${segment.start.toString()}|${segment.end.toString()}`
  }

  async checkRangeSupport(url: string): Promise<{ supported: boolean, size: bigint, acceptRanges: boolean }> {
    const proxyUrl = apiUrl(`/api/download?url=${encodeURIComponent(url)}`)
    const fallback = { supported: false, size: BigInt(0), acceptRanges: false }

    let headResponse: Response
    try {
      headResponse = await fetchWithRetry(proxyUrl, { method: 'HEAD' })
    } catch {
      // Cold start / red caída: no bloqueamos la descarga, usamos el modo por defecto.
      return fallback
    }

    const acceptRangesHeader = headResponse.headers.get('accept-ranges')
    const size = parseContentLength(headResponse.headers.get('content-length'))
    const acceptRanges = acceptRangesHeader === 'bytes'

    if (acceptRanges && size > BigInt(0)) {
      return { supported: true, size, acceptRanges: true }
    }

    try {
      const rangeResponse = await fetchWithTimeout(proxyUrl, {
        method: 'GET',
        headers: { 'Range': 'bytes=0-0' }
      })
      const rangeSupported = rangeResponse.status === 206 || rangeResponse.headers.get('content-range') !== null
      let resolvedSize = size
      if (resolvedSize <= BigInt(0)) {
        resolvedSize = parseContentLength(rangeResponse.headers.get('content-length'))
      }
      if (resolvedSize <= BigInt(0)) {
        const contentRange = rangeResponse.headers.get('content-range')
        const totalMatch = contentRange?.match(/\/(\d+)/)
        if (totalMatch) resolvedSize = parseContentLength(totalMatch[1] ?? null)
      }
      try {
        rangeResponse.body?.cancel()
      } catch {
        // ignore
      }
      return { supported: rangeSupported, size: resolvedSize, acceptRanges: rangeSupported }
    } catch {
      return { supported: false, size, acceptRanges: false }
    }
  }

  createSegments(totalSize: bigint, segmentSize: number): Segment[] {
    const segments: Segment[] = []
    if (totalSize <= BigInt(0)) return segments

    const totalBytes = Number(totalSize)
    const totalSegments = Math.ceil(totalBytes / segmentSize)

    for (let i = 0; i < totalSegments; i++) {
      const start = BigInt(i * segmentSize)
      const end = i === totalSegments - 1
        ? totalSize - BigInt(1)
        : BigInt((i + 1) * segmentSize - 1)

      const segSize = i === totalSegments - 1
        ? totalBytes % segmentSize || segmentSize
        : segmentSize

      segments.push({
        index: i,
        start,
        end,
        size: segSize,
        downloaded: false,
        inProgress: false,
        progress: 0,
        bytesDownloaded: 0,
        retryCount: 0
      })
    }

    return segments
  }

  async downloadSegment(
    url: string,
    segment: Segment,
    signal: AbortSignal,
    onProgress: (bytesDownloaded: number, progress: number) => void
  ): Promise<Blob> {
    const key = this.getSegmentKey(url, segment)
    let partial = this.partialSegments.get(key)
    let alreadyDownloaded = partial?.byteLength || 0

    if (segment.size > 0 && alreadyDownloaded >= segment.size) {
      const completed = new Blob([new Uint8Array(partial!)])
      this.partialSegments.delete(key)
      onProgress(segment.size, 1)
      return completed
    }

    if (alreadyDownloaded > segment.size && segment.size > 0) {
      this.partialSegments.delete(key)
      partial = undefined
      alreadyDownloaded = 0
    }

    const rangeStart = segment.start + BigInt(alreadyDownloaded)
    const proxyUrl = apiUrl(`/api/download?url=${encodeURIComponent(url)}`)
    const requestHeaders: Record<string, string> = {}
    if (segment.size > 0) {
      requestHeaders['Range'] = `bytes=${rangeStart.toString()}-${segment.end.toString()}`
    }
    const response = await fetch(proxyUrl, {
      method: 'GET',
      headers: requestHeaders,
      signal
    })

    if (!response.ok && response.status !== 206) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    if (!response.body) {
      throw new Error('Sin cuerpo de respuesta del servidor')
    }

    if (alreadyDownloaded > 0 && response.status !== 206) {
      this.partialSegments.delete(key)
      partial = undefined
      alreadyDownloaded = 0
    }

    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let receivedLength = 0

    const persistPartial = () => {
      const totalLength = alreadyDownloaded + receivedLength
      if (totalLength <= 0) return
      const combined = new Uint8Array(totalLength)
      if (partial) combined.set(partial, 0)
      let offset = alreadyDownloaded
      for (const chunk of chunks) {
        combined.set(chunk, offset)
        offset += chunk.length
      }
      this.partialSegments.set(key, combined)
    }

    try {
      while (true) {
        if (signal.aborted) {
          await reader.cancel()
          throw new Error('Abortado')
        }
        const { done, value } = await reader.read()
        if (done) break
        if (value) {
          chunks.push(value)
          receivedLength += value.length
          const totalBytes = alreadyDownloaded + receivedLength
          const progress = segment.size > 0 ? Math.min(1, totalBytes / segment.size) : 1
          onProgress(totalBytes, progress)
        }
      }
    } catch (error) {
      persistPartial()
      throw error
    }

    const concatenated = new Uint8Array(alreadyDownloaded + receivedLength)
    if (partial) concatenated.set(partial, 0)
    let offset = alreadyDownloaded
    for (const chunk of chunks) {
      concatenated.set(chunk, offset)
      offset += chunk.length
    }

    this.partialSegments.delete(key)
    return new Blob([concatenated.buffer])
  }

  calculateSpeed(bytesDelta: number): number {
    const now = Date.now()
    this.speedSamples.push({ bytes: bytesDelta, time: now })
    this.speedSamples = this.speedSamples.filter(s => now - s.time < 1000)
    if (this.speedSamples.length === 0) return 0
    const totalBytes = this.speedSamples.reduce((sum, s) => sum + s.bytes, 0)
    return totalBytes
  }

  async assembleFile(segments: Segment[], filename: string, contentType?: string): Promise<void> {
    const sortedSegments = [...segments].sort((a, b) => a.index - b.index)
    const blobs: Blob[] = []
    for (const segment of sortedSegments) {
      if (segment.data) {
        blobs.push(segment.data)
      }
    }
    const mime = contentType && contentType !== 'text/html' ? (contentType.split(';')[0]?.trim() || '') : ''
    const parts: BlobPart[] = []
    for (let i = 0; i < blobs.length; i++) {
      const b = blobs[i]
      if (b) parts.push(b)
    }
    let finalBlob: Blob
    if (parts.length === 0) {
      finalBlob = new Blob([])
    } else if (mime && mime.length > 0) {
      finalBlob = new Blob(parts, { type: mime })
    } else {
      finalBlob = new Blob(parts)
    }
    const objectUrl = window.URL.createObjectURL(finalBlob)
    const link = document.createElement('a')
    link.href = objectUrl
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(objectUrl)
  }
}

export const httpSegmentEngine = new HttpSegmentEngine()
