import { useCallback, useEffect, useRef } from 'react'
import { useDownloadStore } from '../store/useDownloadStore'
import { httpSegmentEngine } from '../engine/HttpSegmentEngine'
import { DownloadTask, Segment, SegmentNetworkState } from '../types'

const NETWORK_ERROR_MESSAGE = 'Conexión perdida. La descarga se reanudará automáticamente.'
const MAX_SEGMENT_RETRIES = 3
const WAITING_NETWORK: SegmentNetworkState = 'WAITING_NETWORK'

function isNetworkFailure(error: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true
  const message = String(
    (error as { message?: string } | undefined)?.message || error || ''
  ).toLowerCase()
  return [
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

export function useDownloadManager() {
  const downloads = useDownloadStore((state) => state.downloads)
  const updateDownload = useDownloadStore((state) => state.updateDownload)
  const activeDownloadsRef = useRef<Set<string>>(new Set())
  const processNextRef = useRef<Map<string, () => void>>(new Map())

  const startDownload = useCallback((task: DownloadTask) => {
    if (activeDownloadsRef.current.has(task.id)) return

    if (!task.supportsRange && task.segments.length > 1) {
      updateDownload(task.id, {
        status: 'error',
        error: 'El servidor no soporta descargas por rangos (Range)'
      })
      return
    }

    activeDownloadsRef.current.add(task.id)

    const abortController = new AbortController()
    updateDownload(task.id, { abortController, status: 'downloading', error: undefined })

    const inProgress = new Set<number>()
    let stopped = false
    let pumpTimer: ReturnType<typeof setTimeout> | null = null

    const getTask = () => useDownloadStore.getState().downloads.find((d) => d.id === task.id)

    const clearPump = () => {
      if (pumpTimer !== null) {
        clearTimeout(pumpTimer)
        pumpTimer = null
      }
    }

    const stop = () => {
      if (stopped) return
      stopped = true
      clearPump()
      if (processNextRef.current.get(task.id) === processNext) {
        processNextRef.current.delete(task.id)
        activeDownloadsRef.current.delete(task.id)
      }
    }

    const scheduleProcess = (delay = 0) => {
      if (stopped) return
      clearPump()
      pumpTimer = setTimeout(() => {
        pumpTimer = null
        processNext()
      }, delay)
    }

    function processNext() {
      if (stopped) return

      const currentTask = getTask()
      if (!currentTask || currentTask.status !== 'downloading') {
        stop()
        return
      }

      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        const waitingSegments = currentTask.segments.map((s) =>
          !s.downloaded && (s.inProgress || s.networkState === WAITING_NETWORK || s.error === NETWORK_ERROR_MESSAGE)
            ? { ...s, inProgress: false, networkState: WAITING_NETWORK, error: undefined }
            : s
        )
        updateDownload(task.id, {
          segments: waitingSegments,
          error: NETWORK_ERROR_MESSAGE
        })
        scheduleProcess(1500)
        return
      }

      const effectiveMax = currentTask.maxConcurrent ||
        useDownloadStore.getState().maxConcurrentSegments ||
        4
      const freeSlots = Math.max(0, effectiveMax - inProgress.size)
      if (freeSlots <= 0) return

      const candidates = currentTask.segments
        .filter((s) =>
          !s.downloaded &&
          !s.inProgress &&
          !inProgress.has(s.index) &&
          (s.retryCount || 0) < MAX_SEGMENT_RETRIES
        )
        .slice(0, freeSlots)

      if (candidates.length === 0) {
        if (inProgress.size > 0) return

        const hasPending = currentTask.segments.some((s) =>
          !s.downloaded && (s.retryCount || 0) < MAX_SEGMENT_RETRIES
        )
        if (hasPending) {
          scheduleProcess(250)
          return
        }

        const hasFailed = currentTask.segments.some((s) => !s.downloaded)
        if (hasFailed) {
          updateDownload(task.id, {
            status: 'error',
            error: 'Fallo al descargar uno o más segmentos'
          })
        }
        stop()
        return
      }

      for (const segment of candidates) {
        startSegment(segment)
      }
    }

    function startSegment(segment: Segment) {
      inProgress.add(segment.index)

      const currentTask = getTask()
      if (!currentTask) {
        inProgress.delete(segment.index)
        stop()
        return
      }

      const markedSegments = currentTask.segments.map((s) =>
        s.index === segment.index
          ? { ...s, inProgress: true, error: undefined, networkState: undefined }
          : s
      )
      updateDownload(task.id, { segments: markedSegments, error: undefined })

      const segmentToDownload = markedSegments.find((s) => s.index === segment.index) || segment

      httpSegmentEngine.downloadSegment(
        currentTask.url,
        segmentToDownload,
        abortController.signal,
        (bytesDownloaded, progress) => {
          const updatedTask = getTask()
          if (!updatedTask || updatedTask.status !== 'downloading') return
          const previousSegment = updatedTask.segments.find((s) => s.index === segment.index)
          const oldBytes = previousSegment?.bytesDownloaded || 0
          const delta = bytesDownloaded - oldBytes
          if (delta <= 0) return

          const newDownloaded = updatedTask.downloaded + BigInt(delta)
          const newSegments = updatedTask.segments.map((s) =>
            s.index === segment.index
              ? { ...s, bytesDownloaded, progress, inProgress: true, networkState: undefined }
              : s
          )
          const speed = httpSegmentEngine.calculateSpeed(delta)
          const totalProgress = updatedTask.totalSize > BigInt(0)
            ? Number((newDownloaded * BigInt(10000)) / updatedTask.totalSize) / 100
            : 0
          updateDownload(task.id, {
            segments: newSegments,
            downloaded: newDownloaded,
            progress: Math.min(100, totalProgress),
            downloadSpeed: speed
          })
        }
      ).then((blob) => {
        inProgress.delete(segment.index)

        const currentTask = getTask()
        if (!currentTask) {
          stop()
          return
        }

        if (currentTask.status !== 'downloading') {
          if (currentTask.status !== 'assembling') stop()
          return
        }

        const newSegments = currentTask.segments.map((s) =>
          s.index === segment.index
            ? { ...s, downloaded: true, inProgress: false, progress: 1, data: blob, bytesDownloaded: s.size, error: undefined, networkState: undefined }
            : s
        )

        const allDownloaded = newSegments.every((s) => s.downloaded)
        const currentDownloaded = newSegments.reduce((sum, s) => {
          if (s.downloaded) return sum + BigInt(s.size)
          return sum + BigInt(s.bytesDownloaded)
        }, BigInt(0))

        if (allDownloaded) {
          updateDownload(task.id, {
            segments: newSegments,
            downloaded: currentTask.totalSize > BigInt(0) ? currentTask.totalSize : currentDownloaded,
            progress: 100,
            status: 'assembling',
            error: undefined,
            downloadSpeed: 0
          })
          stop()

          setTimeout(async () => {
            try {
              const finalTask = getTask()
              if (!finalTask) return
              await httpSegmentEngine.assembleFile(finalTask.segments, finalTask.name, finalTask.contentType)
              updateDownload(task.id, {
                status: 'completed',
                completedAt: Date.now(),
                downloadSpeed: 0,
                error: undefined
              })
            } catch (error) {
              updateDownload(task.id, {
                status: 'error',
                error: error instanceof Error ? error.message : 'Error al ensamblar archivo'
              })
            }
          }, 30)
          return
        }

        const totalProgress = currentTask.totalSize > BigInt(0)
          ? Number((currentDownloaded * BigInt(10000)) / currentTask.totalSize) / 100
          : 0
        updateDownload(task.id, {
          segments: newSegments,
          downloaded: currentDownloaded,
          progress: Math.min(99.9, totalProgress),
          error: undefined
        })
        scheduleProcess(0)
      }).catch((error: unknown) => {
        inProgress.delete(segment.index)

        const currentTask = getTask()
        if (!currentTask) {
          stop()
          return
        }

        if (abortController.signal.aborted || currentTask.status !== 'downloading') {
          stop()
          return
        }

        if (isNetworkFailure(error)) {
          const newSegments = currentTask.segments.map((s) =>
            s.index === segment.index
              ? { ...s, inProgress: false, networkState: WAITING_NETWORK, error: undefined }
              : s
          )
          updateDownload(task.id, {
            segments: newSegments,
            error: NETWORK_ERROR_MESSAGE
          })
          scheduleProcess(typeof navigator !== 'undefined' && navigator.onLine ? 1200 : 2000)
          return
        }

        const previousSegment = currentTask.segments.find((s) => s.index === segment.index)
        const newRetry = (previousSegment?.retryCount || 0) + 1
        const errorMessage = error instanceof Error ? error.message : 'Error de descarga'
        const newSegments = currentTask.segments.map((s) =>
          s.index === segment.index
            ? { ...s, inProgress: false, retryCount: newRetry, error: errorMessage, networkState: undefined }
            : s
        )
        updateDownload(task.id, { segments: newSegments })

        if (newRetry < MAX_SEGMENT_RETRIES) {
          scheduleProcess(400 * newRetry)
        } else {
          updateDownload(task.id, {
            status: 'error',
            error: 'Fallo al descargar uno o más segmentos'
          })
          stop()
        }
      })
    }

    processNextRef.current.set(task.id, processNext)
    processNext()
  }, [updateDownload])

  useEffect(() => {
    const handleOnline = () => {
      const tasks = useDownloadStore.getState().downloads
      for (const task of tasks) {
        if (task.status !== 'downloading') continue

        updateDownload(task.id, {
          error: undefined,
          segments: task.segments.map((s) =>
            s.downloaded
              ? s
              : { ...s, inProgress: false, error: undefined, networkState: undefined }
          )
        })

        const runner = processNextRef.current.get(task.id)
        if (runner) {
          runner()
        } else if (!activeDownloadsRef.current.has(task.id)) {
          startDownload(task)
        }
      }
    }

    const handleOffline = () => {
      const tasks = useDownloadStore.getState().downloads
      for (const task of tasks) {
        if (task.status !== 'downloading') continue
        const waitingSegments = task.segments.map((s) =>
          !s.downloaded && (s.inProgress || s.networkState === WAITING_NETWORK || s.error === NETWORK_ERROR_MESSAGE)
            ? { ...s, inProgress: false, networkState: WAITING_NETWORK, error: undefined }
            : s
        )
        updateDownload(task.id, {
          segments: waitingSegments,
          error: NETWORK_ERROR_MESSAGE
        })
      }
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [startDownload, updateDownload])

  useEffect(() => {
    for (const task of downloads) {
      if (task.status === 'downloading' && !activeDownloadsRef.current.has(task.id)) {
        startDownload(task)
      } else if (task.status === 'paused' && activeDownloadsRef.current.has(task.id)) {
        activeDownloadsRef.current.delete(task.id)
        processNextRef.current.delete(task.id)
      } else if (
        task.status !== 'downloading' &&
        task.status !== 'assembling' &&
        activeDownloadsRef.current.has(task.id)
      ) {
        activeDownloadsRef.current.delete(task.id)
        processNextRef.current.delete(task.id)
      }
    }
  }, [downloads, startDownload])

  return { startDownload }
}
