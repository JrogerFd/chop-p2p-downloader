import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DownloadTask } from '../types'

interface DownloadStore {
  downloads: DownloadTask[]
  activeDownloadId: string | null
  maxConcurrentSegments: number
  defaultSegmentSize: number
  
  addDownload: (task: DownloadTask) => void
  updateDownload: (id: string, updates: Partial<DownloadTask>) => void
  removeDownload: (id: string) => void
  pauseDownload: (id: string) => void
  resumeDownload: (id: string) => void
  cancelDownload: (id: string) => void
  setActiveDownload: (id: string | null) => void
  setMaxConcurrentSegments: (count: number) => void
  setDefaultSegmentSize: (size: number) => void
  clearCompleted: () => void
}

export const useDownloadStore = create<DownloadStore>()(
  persist(
    (set, get) => ({
      downloads: [],
      activeDownloadId: null,
      maxConcurrentSegments: 4,
      defaultSegmentSize: 262144,
      
      addDownload: (task) => set((state) => ({ 
        downloads: [...state.downloads, task],
        activeDownloadId: task.id
      })),
      
      updateDownload: (id, updates) => set((state) => ({
        downloads: state.downloads.map((d) => 
          d.id === id ? { ...d, ...updates } : d
        )
      })),
      
      removeDownload: (id) => {
        const task = get().downloads.find(d => d.id === id)
        if (task?.abortController) {
          task.abortController.abort()
        }
        set((state) => ({
          downloads: state.downloads.filter((d) => d.id !== id),
          activeDownloadId: state.activeDownloadId === id ? null : state.activeDownloadId
        }))
      },
      
      pauseDownload: (id) => {
        const task = get().downloads.find(d => d.id === id)
        if (task?.abortController) {
          task.abortController.abort()
        }
        set((state) => ({
          downloads: state.downloads.map((d) => 
            d.id === id ? { 
              ...d, 
              status: 'paused', 
              abortController: undefined,
              segments: d.segments.map(s => s.downloaded ? s : { ...s, inProgress: false })
            } : d
          )
        }))
      },
      
      resumeDownload: (id) => set((state) => ({
        downloads: state.downloads.map((d) => 
          d.id === id ? { 
            ...d, 
            status: 'downloading',
            segments: d.segments.map(s => s.downloaded ? s : { ...s, inProgress: false, error: undefined })
          } : d
        )
      })),
      
      cancelDownload: (id) => {
        const task = get().downloads.find(d => d.id === id)
        if (task?.abortController) {
          task.abortController.abort()
        }
        set((state) => ({
          downloads: state.downloads.filter((d) => d.id !== id),
          activeDownloadId: state.activeDownloadId === id ? null : state.activeDownloadId
        }))
      },
      
      setActiveDownload: (id) => set({ activeDownloadId: id }),
      
      setMaxConcurrentSegments: (count) => set({ maxConcurrentSegments: count }),
      
      setDefaultSegmentSize: (size) => set({ defaultSegmentSize: size }),
      
      clearCompleted: () => set((state) => ({
        downloads: state.downloads.filter((d) => d.status !== 'completed')
      }))
    }),
    {
      name: 'chop-http-segment-storage',
      partialize: (state) => ({
        downloads: state.downloads.map(d => ({
          ...d,
          totalSize: typeof d.totalSize === 'bigint' ? d.totalSize.toString() : d.totalSize,
          downloaded: typeof d.downloaded === 'bigint' ? d.downloaded.toString() : d.downloaded,
          segments: d.segments.map(s => ({
            ...s,
            start: typeof s.start === 'bigint' ? s.start.toString() : s.start,
            end: typeof s.end === 'bigint' ? s.end.toString() : s.end,
            data: undefined
          })),
          abortController: undefined
        })),
        maxConcurrentSegments: state.maxConcurrentSegments,
        defaultSegmentSize: state.defaultSegmentSize
      }),
      merge: (persistedState: any, currentState) => {
        const merged = { ...currentState, ...persistedState }
        if (persistedState?.downloads) {
          merged.downloads = persistedState.downloads.map((d: any) => ({
            ...d,
            totalSize: typeof d.totalSize === 'string' ? BigInt(d.totalSize) : (typeof d.totalSize === 'bigint' ? d.totalSize : BigInt(0)),
            downloaded: typeof d.downloaded === 'string' ? BigInt(d.downloaded) : (typeof d.downloaded === 'bigint' ? d.downloaded : BigInt(0)),
            segments: (d.segments || []).map((s: any) => ({
              ...s,
              start: typeof s.start === 'string' ? BigInt(s.start) : (typeof s.start === 'bigint' ? s.start : BigInt(0)),
              end: typeof s.end === 'string' ? BigInt(s.end) : (typeof s.end === 'bigint' ? s.end : BigInt(0)),
              data: undefined,
              inProgress: false
            }))
          }))
        }
        return merged
      }
    }
  )
)
