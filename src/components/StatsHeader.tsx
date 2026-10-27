import { Activity, Download, HardDrive } from 'lucide-react'
import { useDownloadStore } from '../store/useDownloadStore'

export default function StatsHeader() {
  const { downloads } = useDownloadStore()

  const totalDownloaded = downloads.reduce((sum, d) => sum + d.downloaded, BigInt(0))
  const activeCount = downloads.filter(d => d.status === 'downloading' || d.status === 'assembling').length
  const completedCount = downloads.filter(d => d.status === 'completed').length

  const formatBytes = (bytes: bigint) => {
    const num = Number(bytes)
    if (num === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(num) / Math.log(k))
    if (i < 0) return num + ' B'
    return parseFloat((num / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  return (
    <header className="bg-cyber-surface border-b border-cyber-border">
      <div className="container mx-auto px-6 py-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-cyber-primary to-cyber-secondary rounded-lg flex items-center justify-center">
              <Activity className="w-6 h-6 text-cyber-bg" />
            </div>
            <div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-cyber-primary to-cyber-secondary bg-clip-text text-transparent">
                CHOP HTTP SEGMENT MANAGER
              </h1>
              <p className="text-xs text-gray-500">Multi-hilo HTTP por Rangos • BitMesh en tiempo real</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div className="bg-cyber-bg border border-cyber-border rounded-lg p-3">
            <div className="flex items-center gap-2 mb-1">
              <Download className="w-4 h-4 text-cyber-primary" />
              <span className="text-xs text-gray-400">TOTAL DESCARGADO</span>
            </div>
            <p className="text-lg font-mono font-semibold">{formatBytes(totalDownloaded)}</p>
          </div>

          <div className="bg-cyber-bg border border-cyber-border rounded-lg p-3">
            <div className="flex items-center gap-2 mb-1">
              <Activity className="w-4 h-4 text-cyber-warn" />
              <span className="text-xs text-gray-400">ACTIVAS</span>
            </div>
            <p className="text-lg font-mono font-semibold">{activeCount}</p>
          </div>

          <div className="bg-cyber-bg border border-cyber-border rounded-lg p-3">
            <div className="flex items-center gap-2 mb-1">
              <HardDrive className="w-4 h-4 text-cyber-accent" />
              <span className="text-xs text-gray-400">COMPLETADAS</span>
            </div>
            <p className="text-lg font-mono font-semibold">{completedCount}</p>
          </div>
        </div>
      </div>
    </header>
  )
}
