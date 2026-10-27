export class DownloadEngine {
  private speedSamples: Array<{ bytes: bigint, time: number }> = []
  maxConcurrent: number = 4

  updateConcurrent(count: number) {
    this.maxConcurrent = count
  }

  calculateSpeed(bytesDelta: bigint): number {
    const now = Date.now()
    this.speedSamples.push({ bytes: bytesDelta, time: now })
    this.speedSamples = this.speedSamples.filter(s => now - s.time < 1000)
    if (this.speedSamples.length === 0) return 0
    const totalBytes = this.speedSamples.reduce((sum, s) => sum + Number(s.bytes), 0)
    return totalBytes
  }

  createChunks(totalSize: bigint, chunkSize: number): Array<any> {
    const chunks: any[] = []
    if (totalSize <= BigInt(0)) return chunks
    const totalBytesNum = Number(totalSize)
    const totalChunks = Math.ceil(totalBytesNum / chunkSize)

    for (let i = 0; i < totalChunks; i++) {
      const start = BigInt(i * chunkSize)
      const end = i === totalChunks - 1 ? totalSize - BigInt(1) : BigInt((i + 1) * chunkSize - 1)
      const size = i === totalChunks - 1
        ? (totalBytesNum % chunkSize) || chunkSize
        : chunkSize

      chunks.push({
        index: i,
        start,
        end,
        size,
        downloaded: false,
        inProgress: false,
        progress: 0
      })
    }

    return chunks
  }

  async downloadRange(url: string, start: bigint, end: bigint, onProgress: (loaded: number) => void): Promise<ArrayBuffer> {
    const controller = new AbortController()
    const response = await fetch(url, {
      headers: {
        'Range': `bytes=${start.toString()}-${end.toString()}`
      },
      signal: controller.signal
    })

    if (!response.ok && response.status !== 206) {
      throw new Error(`HTTP ${response.status}`)
    }

    const reader = response.body?.getReader()
    if (!reader) throw new Error('No reader')

    const contentLength = Number(end - start + BigInt(1))
    let receivedLength = 0
    const chunks: Uint8Array[] = []

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        chunks.push(value)
        receivedLength += value.length
        if (contentLength > 0) {
          onProgress(receivedLength / contentLength)
        }
      }
    }

    const concatenated = new Uint8Array(receivedLength)
    let offset = 0
    for (const chunk of chunks) {
      concatenated.set(chunk, offset)
      offset += chunk.length
    }

    return concatenated.buffer
  }
}

export const downloadEngine = new DownloadEngine()
