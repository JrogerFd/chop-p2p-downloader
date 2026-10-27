import { useEffect, useRef } from 'react'
import { useDownloadStore } from '../store/useDownloadStore'
import { httpSegmentEngine } from '../engine/HttpSegmentEngine'
import { DownloadTask } from '../types'

export function useDownloadManager() {
  const { downloads, updateDownload, maxConcurrentSegments } = useDownloadStore()
  const activeDownloadsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    for (const task of downloads) {
      if (task.status === 'downloading' && !activeDownloadsRef.current.has(task.id)) {
        startDownload(task)
      }
      if (task.status === 'paused' && activeDownloadsRef.current.has(task.id)) {
        activeDownloadsRef.current.delete(task.id)
      }
      if (task.status !== 'downloading' && task.status !== 'paused' && activeDownloadsRef.current.has(task.id) && task.status !== 'assembling') {
        activeDownloadsRef.current.delete(task.id)
      }
    }
  }, [downloads, maxConcurrentSegments])

  const startDownload = async (task: DownloadTask) => {
    if (activeDownloadsRef.current.has(task.id)) return
    activeDownloadsRef.current.add(task.id)

    const abortController = new AbortController()
    updateDownload(task.id, { abortController, status: 'downloading' })

    try {
      if (!task.supportsRange && task.segments.length > 1) {
        updateDownload(task.id, { status: 'error', error: 'El servidor no soporta descargas por rangos (Range)' })
        activeDownloadsRef.current.delete(task.id)
        return
      }

      const inProgress = new Set<number>()

      const processNext = async () => {
        const state = useDownloadStore.getState()
        const currentTask = state.downloads.find(d => d.id === task.id)
        if (!currentTask || currentTask.status !== 'downloading') {
          activeDownloadsRef.current.delete(task.id)
          return
        }

        const effectiveMax = currentTask.maxConcurrent || maxConcurrentSegments || 4
        const freeSlots = Math.max(0, effectiveMax - inProgress.size)
        if (freeSlots <= 0) {
          setTimeout(() => processNext(), 10)
          return
        }

        const baseSegments = currentTask.segments
        const candidates = baseSegments
          .filter(s => !s.downloaded && !s.inProgress && !inProgress.has(s.index) && (s.retryCount || 0) < 3)
          .slice(0, freeSlots)

        if (candidates.length === 0) {
          if (inProgress.size === 0) {
            const t = useDownloadStore.getState().downloads.find(d => d.id === task.id)
            if (t && t.status === 'downloading' && t.segments.some(s => !s.downloaded && (s.retryCount || 0) < 3)) {
              setTimeout(() => processNext(), 15)
              return
            }
            if (t?.status === 'downloading') {
              setTimeout(() => processNext(), 30)
              return
            }
            activeDownloadsRef.current.delete(task.id)
          } else {
            setTimeout(() => processNext(), 10)
          }
          return
        }

        for (const segment of candidates) {
          inProgress.add(segment.index)

          const freshSegments = useDownloadStore.getState().downloads.find(d => d.id === task.id)?.segments || baseSegments
          updateDownload(task.id, {
            segments: freshSegments.map(s =>
              s.index === segment.index ? { ...s, inProgress: true } : s
            )
          })

          const segmentToDownload = (useDownloadStore.getState().downloads.find(d => d.id === task.id)?.segments || freshSegments).find(s => s.index === segment.index) || segment
          httpSegmentEngine.downloadSegment(
            currentTask.url,
            segmentToDownload,
            abortController.signal,
            (bytesDownloaded, progress) => {
              const updatedTask = useDownloadStore.getState().downloads.find(d => d.id === task.id)
              if (!updatedTask) return
              const oldBytes = updatedTask.segments[segment.index]?.bytesDownloaded || 0
              const delta = bytesDownloaded - oldBytes
              if (delta <= 0) return
              const newDownloaded = updatedTask.downloaded + BigInt(delta)
              const newSegments = updatedTask.segments.map(s =>
                s.index === segment.index
                  ? { ...s, bytesDownloaded, progress, inProgress: true }
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
          ).then(blob => {
            const updatedTask = useDownloadStore.getState().downloads.find(d => d.id === task.id)
            if (!updatedTask) return
            const st = useDownloadStore.getState().downloads.find(d => d.id === task.id)
            if (!st || st.status !== 'downloading') {
              inProgress.delete(segment.index)
              if (st?.status !== 'paused' && st?.status !== 'assembling') {
                activeDownloadsRef.current.delete(task.id)
              }
              return
            }

            const newSegments = updatedTask.segments.map(s =>
              s.index === segment.index
                ? { ...s, downloaded: true, inProgress: false, progress: 1, data: blob, bytesDownloaded: s.size }
                : s
            )

            inProgress.delete(segment.index)

            const allDownloaded = newSegments.every(s => s.downloaded)
            const currentDownloaded = newSegments.reduce((sum, s) => {
              if (s.downloaded) return sum + BigInt(s.size)
              return sum + BigInt(s.bytesDownloaded)
            }, BigInt(0))

            const taskAfter = useDownloadStore.getState().downloads.find(d => d.id === task.id) || currentTask
            if (allDownloaded) {
              updateDownload(task.id, {
                segments: newSegments,
                downloaded: taskAfter.totalSize > BigInt(0) ? taskAfter.totalSize : currentDownloaded,
                progress: 100,
                status: 'assembling'
              })
              setTimeout(async () => {
                try {
                  const finalSegments = useDownloadStore.getState().downloads.find(d => d.id === task.id)?.segments || newSegments
                  const tname = useDownloadStore.getState().downloads.find(d => d.id === task.id)?.name || taskAfter.name
                  const ttype = useDownloadStore.getState().downloads.find(d => d.id === task.id)?.contentType
                  await httpSegmentEngine.assembleFile(finalSegments, tname, ttype)
                  updateDownload(task.id, {
                    status: 'completed',
                    completedAt: Date.now(),
                    downloadSpeed: 0
                  })
                  activeDownloadsRef.current.delete(task.id)
                } catch (e: any) {
                  updateDownload(task.id, { status: 'error', error: e?.message || 'Error al ensamblar archivo' })
                  activeDownloadsRef.current.delete(task.id)
                }
              }, 30)
            } else {
              const totalProg = taskAfter.totalSize > BigInt(0)
                ? Number((currentDownloaded * BigInt(10000)) / taskAfter.totalSize) / 100
                : 0
              updateDownload(task.id, {
                segments: newSegments,
                downloaded: currentDownloaded,
                progress: Math.min(99.9, totalProg)
              })
      processNext()
      setTimeout(() => processNext(), 0)
      setTimeout(() => processNext(), 5)
            }
          }).catch(error => {
            if (error?.message === 'Abortado') {
              inProgress.delete(segment.index)
              const t = useDownloadStore.getState().downloads.find(d => d.id === task.id)
              if (t?.status !== 'downloading') {
                activeDownloadsRef.current.delete(task.id)
              }
              return
            }

            const updatedTask = useDownloadStore.getState().downloads.find(d => d.id === task.id)
            if (!updatedTask) return
            const newRetry = (updatedTask.segments[segment.index]?.retryCount || 0) + 1
            const newSegments = updatedTask.segments.map(s =>
              s.index === segment.index
                ? { ...s, inProgress: false, retryCount: newRetry, error: error?.message }
                : s
            )
            inProgress.delete(segment.index)
            updateDownload(task.id, { segments: newSegments })

            if (newRetry < 3) {
              setTimeout(() => processNext(), 400)
            } else {
              updateDownload(task.id, { status: 'error', error: 'Fallo al descargar uno o más segmentos' })
              activeDownloadsRef.current.delete(task.id)
            }
          })
        }

        if (candidates.length === 0 && inProgress.size === 0) {
          const t = useDownloadStore.getState().downloads.find(d => d.id === task.id)
          if (!t) {
            activeDownloadsRef.current.delete(task.id)
            return
          }
          if (t.status === 'downloading') {
            const hasPending = t.segments.some(s => !s.downloaded && (s.retryCount || 0) < 3)
            if (hasPending) {
              setTimeout(() => processNext(), 25)
              return
            }
          }
          if (t.status !== 'downloading') {
            activeDownloadsRef.current.delete(task.id)
            return
          }
          activeDownloadsRef.current.delete(task.id)
        }
      }

      processNext()
      // Forzar arranque inmediato de hilos
      setTimeout(() => processNext(), 0)
      setTimeout(() => processNext(), 10)
      setTimeout(() => processNext(), 50)
      setTimeout(() => processNext(), 100)
      // Polling extra para garantizar arranque
      const kick = setInterval(() => {
        const t = useDownloadStore.getState().downloads.find(d => d.id === task.id)
        if (!t || t.status !== 'downloading') {
          clearInterval(kick)
          return
        }
        if (inProgress.size === 0 && t.segments.some(s => !s.downloaded && (s.retryCount || 0) < 3)) {
          processNext()
        }
      }, 30)
      setTimeout(() => clearInterval(kick), 3000)
    } catch (error: any) {
      updateDownload(task.id, { status: 'error', error: error?.message || 'Error al iniciar descarga' })
      activeDownloadsRef.current.delete(task.id)
    }
  }

  return { startDownload }
}
