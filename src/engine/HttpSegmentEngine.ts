import { Segment } from '../types'

export class HttpSegmentEngine {
  private speedSamples: Array<{ bytes: number, time: number }> = []

  async checkRangeSupport(url: string): Promise<{ supported: boolean, size: bigint, acceptRanges: boolean }> {
    try {
      const proxyUrl = `/api/download?url=${encodeURIComponent(url)}`
      const headResponse = await fetch(proxyUrl, { method: 'HEAD' })
      const acceptRangesHeader = headResponse.headers.get('accept-ranges')
      const contentLength = headResponse.headers.get('content-length')
      const size = contentLength ? BigInt(contentLength) : BigInt(0)

      const acceptRanges = acceptRangesHeader === 'bytes'

      if (acceptRanges && size > BigInt(0)) {
        return { supported: true, size, acceptRanges: true }
      }

      try {
        const rangeResponse = await fetch(proxyUrl, {
          method: 'GET',
          headers: { 'Range': 'bytes=0-0' }
        })
        const rangeSupported = rangeResponse.status === 206 || rangeResponse.headers.get('content-range') !== null
        rangeResponse.body?.cancel()
        return { supported: rangeSupported, size, acceptRanges: rangeSupported }
      } catch {
        return { supported: false, size, acceptRanges: false }
      }
    } catch (error) {
      throw new Error('No se pudo verificar si el servidor soporta descargas por rangos')
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
    const proxyUrl = `/api/download?url=${encodeURIComponent(url)}`
    const response = await fetch(proxyUrl, {
      method: 'GET',
      headers: {
        'Range': `bytes=${segment.start.toString()}-${segment.end.toString()}`
      },
      signal
    })

    if (!response.ok && response.status !== 206) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    if (!response.body) {
      throw new Error('Sin cuerpo de respuesta del servidor')
    }

    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let receivedLength = 0

    while (true) {
      if (signal.aborted) {
        reader.cancel()
        throw new Error('Abortado')
      }
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        chunks.push(value)
        receivedLength += value.length
        const progress = segment.size > 0 ? receivedLength / segment.size : 1
        onProgress(receivedLength, progress)
      }
    }

    const concatenated = new Uint8Array(receivedLength)
    let offset = 0
    for (const chunk of chunks) {
      concatenated.set(chunk, offset)
      offset += chunk.length
    }

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
