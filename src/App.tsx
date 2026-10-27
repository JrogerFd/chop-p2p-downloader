import { useEffect, useState } from 'react'
import StatsHeader from './components/StatsHeader'
import AddDownload from './components/AddDownload'
import DownloadCard from './components/DownloadCard'
import BitMeshGrid from './components/BitMeshGrid'
import { useDownloadStore } from './store/useDownloadStore'
import { useDownloadManager } from './hooks/useDownloadManager'
import { Activity, Zap } from 'lucide-react'

export default function App() {
  useDownloadManager()
  const { downloads, activeDownloadId, maxConcurrentSegments, setMaxConcurrentSegments } = useDownloadStore()
  const [activeTask, setActiveTask] = useState<any>(null)

  useEffect(() => {
    const task = downloads.find(d => d.id === activeDownloadId)
    setActiveTask(task || null)
  }, [downloads, activeDownloadId])

  return (
    <div className="min-h-screen">
      <StatsHeader />

      <main className="container mx-auto px-6 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <AddDownload />

            <div>
              <div className="flex items-center gap-2 mb-3">
                <Activity className="w-4 h-4 text-cyber-primary" />
                <h2 className="text-sm font-semibold">GESTOR DE DESCARGAS AVANZADO POR SEGMENTOS HTTP</h2>
              </div>
              <div className="space-y-3">
                {downloads.length === 0 ? (
                  <div className="bg-cyber-surface border border-cyber-border rounded-lg p-8 text-center">
                    <Zap className="w-12 h-12 mx-auto mb-3 text-cyber-primary opacity-50" />
                    <p className="text-gray-500 text-sm">Sin descargas activas</p>
                    <p className="text-gray-600 text-xs mt-1">Agrega una URL directa HTTP/HTTPS para iniciar descarga por rangos</p>
                  </div>
                ) : (
                  downloads.map((task) => (
                    <DownloadCard key={task.id} task={task} />
                  ))
                )}
              </div>
            </div>

            {activeTask && activeTask.segments && activeTask.segments.length > 0 && (
              <BitMeshGrid segments={activeTask.segments} />
            )}
          </div>

          <div className="space-y-6">
            <div className="bg-cyber-surface border border-cyber-border rounded-lg overflow-hidden">
              <div className="p-3 border-b border-cyber-border bg-cyber-bg/50 flex items-center gap-2">
                <Zap className="w-4 h-4 text-cyber-warn" />
                <h2 className="text-sm font-semibold">CONFIGURACIÓN DE SEGMENTOS</h2>
              </div>
              <div className="p-4 space-y-3">
                <div>
                  <div className="flex justify-between text-xs mb-2">
                    <span className="text-gray-400">HILOS HTTP CONCURRENTES</span>
                    <span className="text-cyber-primary font-mono">{maxConcurrentSegments}</span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="8"
                    value={maxConcurrentSegments}
                    onChange={(e) => setMaxConcurrentSegments(parseInt(e.target.value))}
                    className="w-full accent-cyber-primary"
                  />
                  <div className="flex justify-between text-xs text-gray-600 mt-1">
                    <span>1</span>
                    <span>8</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
