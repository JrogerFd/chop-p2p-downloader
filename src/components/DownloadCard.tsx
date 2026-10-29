import { Download, Pause, Play, Trash2, FileDown, X, RefreshCw, CheckCircle } from 'lucide-react'
import { DownloadTask } from '../types'
import { useDownloadStore } from '../store/useDownloadStore'

interface DownloadCardProps {
  task: DownloadTask
}

export default function DownloadCard({ task }: DownloadCardProps) {
  const { pauseDownload, resumeDownload, cancelDownload, removeDownload } = useDownloadStore()
  const waitingForNetwork = task.segments.some((s) => s.networkState === 'WAITING_NETWORK')

  const formatBytes = (bytes: bigint) => {
    const num = Number(bytes)
    if (num === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(num) / Math.log(k))
    if (i < 0) return num + ' B'
    return parseFloat((num / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const formatSpeed = (bytesPerSec: number) => {
    if (!bytesPerSec || bytesPerSec === 0) return '0 B/s'
    const k = 1024
    const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s']
    const i = Math.floor(Math.log(bytesPerSec) / Math.log(k))
    if (i < 0) return bytesPerSec + ' B/s'
    return parseFloat((bytesPerSec / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const getStatusColor = () => {
    switch (task.status) {
      case 'downloading': return waitingForNetwork ? 'text-cyber-warn' : 'text-cyber-primary'
      case 'completed': return 'text-cyber-secondary'
      case 'paused': return 'text-cyber-warn'
      case 'assembling': return 'text-cyber-accent'
      case 'checking': return 'text-cyber-warn'
      case 'error': return 'text-cyber-error'
      default: return 'text-gray-500'
    }
  }

  const getStatusText = () => {
    switch (task.status) {
      case 'downloading': return waitingForNetwork ? 'ESPERANDO RED' : 'DESCARGANDO'
      case 'completed': return 'COMPLETADO'
      case 'paused': return 'PAUSADO'
      case 'assembling': return 'ENSAMBLANDO'
      case 'checking': return 'VERIFICANDO'
      case 'error': return 'ERROR'
      default: return task.status.toUpperCase()
    }
  }

  return (
    <div className="bg-cyber-surface border border-cyber-border rounded-lg overflow-hidden hover:border-cyber-primary/50 transition-all">
      <div className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <FileDown className="w-4 h-4 text-cyber-secondary flex-shrink-0" />
              <h3 className="font-semibold truncate text-sm">{task.name}</h3>
            </div>
            <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap">
              <span className={getStatusColor()}>{getStatusText()}</span>
              <span>HTTP MULTI-HILO POR SEGMENTOS</span>
              {task.supportsRange ? (
                <span className="text-cyber-primary">RANGE: SÍ</span>
              ) : (
                <span className="text-cyber-error">RANGE: NO</span>
              )}
              <span>{formatBytes(task.downloaded)} / {formatBytes(task.totalSize)}</span>
            </div>
            {task.error && (
              <p className="text-xs text-cyber-error mt-1 truncate">{task.error}</p>
            )}
          </div>

          <div className="flex items-center gap-1">
            {task.status === 'downloading' && (
              <button
                onClick={() => pauseDownload(task.id)}
                className="p-2 hover:bg-cyber-bg rounded transition-colors"
                title="Pausar"
              >
                <Pause className="w-4 h-4" />
              </button>
            )}
            {task.status === 'paused' && (
              <button
                onClick={() => resumeDownload(task.id)}
                className="p-2 hover:bg-cyber-bg rounded transition-colors"
                title="Reanudar"
              >
                <Play className="w-4 h-4" />
              </button>
            )}
            {(task.status === 'downloading' || task.status === 'paused') && (
              <button
                onClick={() => cancelDownload(task.id)}
                className="p-2 hover:bg-cyber-bg hover:text-cyber-error rounded transition-colors"
                title="Cancelar"
              >
                <X className="w-4 h-4" />
              </button>
            )}
            {(task.status === 'completed' || task.status === 'error') && (
              <button
                onClick={() => removeDownload(task.id)}
                className="p-2 hover:bg-cyber-bg rounded transition-colors"
                title="Eliminar"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        <div className="mb-2">
          <div className="flex justify-between text-xs mb-1">
            <span className="text-gray-400">PROGRESO</span>
            <span className="text-cyber-primary font-mono">{task.progress.toFixed(1)}%</span>
          </div>
          <div className="h-2 bg-cyber-bg rounded-full overflow-hidden border border-cyber-border">
            <div
              className="h-full bg-gradient-to-r from-cyber-primary to-cyber-secondary transition-all duration-300 relative"
              style={{ width: task.progress + '%' }}
            >
              {(task.status === 'downloading' || task.status === 'assembling') && (
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-scan" />
              )}
            </div>
          </div>
        </div>

        {(task.status === 'downloading' || task.status === 'assembling') && (
          <div className="flex justify-between text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <Download className="w-3 h-3" />
              <span className="font-mono text-cyber-secondary">{formatSpeed(task.downloadSpeed)}</span>
            </span>
            <span className="flex items-center gap-1">
              <RefreshCw className="w-3 h-3 animate-spin" />
              <span className="text-gray-400">{task.segments.filter(s => s.downloaded).length}/{task.segments.length} SEGMENTOS</span>
            </span>
            <span className="flex items-center gap-1">
              <CheckCircle className="w-3 h-3 text-cyber-primary" />
              <span>{task.maxConcurrent} HILOS</span>
            </span>
          </div>
        )}

        {task.status === 'completed' && (
          <div className="text-xs text-cyber-secondary flex items-center gap-1">
            <CheckCircle className="w-3 h-3" />
            <span>Descarga completada - Archivo guardado</span>
          </div>
        )}
      </div>
    </div>
  )
}
