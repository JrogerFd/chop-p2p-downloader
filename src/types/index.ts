export interface Segment {
  index: number
  start: bigint
  end: bigint
  size: number
  downloaded: boolean
  inProgress: boolean
  data?: Blob
  progress: number
  bytesDownloaded: number
  retryCount: number
  error?: string
}

export interface DownloadTask {
  id: string
  name: string
  url: string
  totalSize: bigint
  downloaded: bigint
  status: 'idle' | 'checking' | 'downloading' | 'paused' | 'completed' | 'error' | 'assembling'
  progress: number
  downloadSpeed: number
  segments: Segment[]
  createdAt: number
  completedAt?: number
  error?: string
  supportsRange: boolean
  segmentSize: number
  maxConcurrent: number
  abortController?: AbortController
  contentType?: string
}

export interface BitMeshStatus {
  totalSegments: number
  completedSegments: number
  inProgressSegments: number
  pendingSegments: number
  bytesDownloaded: bigint
  bytesTotal: bigint
}
