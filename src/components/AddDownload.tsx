import { useState } from 'react'
import { Plus, Link, AlertTriangle } from 'lucide-react'
import { useDownloadStore } from '../store/useDownloadStore'
import { v4 as uuidv4 } from 'uuid'
import { httpSegmentEngine } from '../engine/HttpSegmentEngine'

export default function AddDownload() {
  const [input, setInput] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [warning, setWarning] = useState<string | null>(null)
  const addDownload = useDownloadStore((state) => state.addDownload)
  const { maxConcurrentSegments, defaultSegmentSize } = useDownloadStore()

  const handleAdd = async () => {
    if (!input.trim()) return
    const url = input.trim()
    const isUrl = url.startsWith('http://') || url.startsWith('https://')
    if (!isUrl) {
      alert('Ingresa una URL directa HTTP/HTTPS válida')
      return
    }

    setLoading(true)
    setWarning(null)
    try {
      let acceptsRanges = false
      let contentLength = 0
      let filename = ''
      let fileContentType: string | undefined

      try {
        const response = await fetch(`/api/verify?url=${encodeURIComponent(url)}`)
        const contentTypeHeader = response.headers.get('content-type') || ''
        if (contentTypeHeader.includes('text/html')) {
          await response.text()
          throw new Error('Respuesta inesperada del servidor (HTML). Verifica que el backend esté corriendo en el puerto correcto.')
        }
        if (response.ok) {
          const data = await response.json()
          acceptsRanges = !!data.acceptsRanges
          contentLength = typeof data.contentLength === 'number' ? data.contentLength : 0
          filename = data.filename || ''
          fileContentType = data.contentType || undefined
        } else {
          const data = await response.json().catch(() => ({}))
          throw new Error(data?.error || 'No se pudo verificar si el servidor soporta descargas por rangos')
        }
      } catch (err: any) {
        throw err
      }

      if (!acceptsRanges) {
        setWarning('Soporte de rangos no detectado: iniciando descarga en hilo único (fallback)')
      }

      const totalSize = contentLength > 0 ? BigInt(contentLength) : BigInt(0)
      let segments = httpSegmentEngine.createSegments(totalSize, defaultSegmentSize)

      // Si hay tamaño conocido y soporte de rangos pero no se generaron segmentos (edge case)
      if (acceptsRanges && totalSize > BigInt(0) && segments.length === 0) {
        const segmentSize = defaultSegmentSize
        const totalBytes = Number(totalSize)
        const totalSegments = Math.ceil(totalBytes / segmentSize)
        segments = []
        for (let i = 0; i < totalSegments; i++) {
          const start = BigInt(i * segmentSize)
          const end = i === totalSegments - 1 ? totalSize - BigInt(1) : BigInt((i + 1) * segmentSize - 1)
          const segSize = i === totalSegments - 1 ? (totalBytes % segmentSize) || segmentSize : segmentSize
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
          } as any)
        }
      }

      if (segments.length === 0 && totalSize > BigInt(0)) {
        // Fallback for single-threaded download if range not supported or size unknown but we need to create a segment
      }

      let effectiveSegments = segments
      if (!acceptsRanges || effectiveSegments.length === 0) {
        // Create a single segment for fallback
        effectiveSegments = [{
          index: 0,
          start: BigInt(0),
          end: totalSize > BigInt(0) ? totalSize - BigInt(1) : BigInt(0),
          size: totalSize > BigInt(0) ? Number(totalSize) : 0,
          downloaded: false,
          inProgress: false,
          progress: 0,
          bytesDownloaded: 0,
          retryCount: 0
        }]
      }

      const fileName = filename || url.split('/').filter(Boolean).pop() || 'descarga'

      const task: any = {
        id: uuidv4(),
        name: decodeURIComponent(fileName),
        url,
        totalSize,
        downloaded: BigInt(0),
        status: 'downloading',
        progress: 0,
        downloadSpeed: 0,
        segments: effectiveSegments,
        createdAt: Date.now(),
        supportsRange: acceptsRanges,
        segmentSize: defaultSegmentSize,
        maxConcurrent: acceptsRanges ? maxConcurrentSegments : 1,
        abortController: undefined,
        contentType: fileContentType
      }

      addDownload(task)
      setInput('')
      setIsOpen(false)
    } catch (e: any) {
      alert(e?.message || 'Error al verificar la URL')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mb-6">
      {!isOpen ? (
        <button
          onClick={() => setIsOpen(true)}
          className="w-full bg-gradient-to-r from-cyber-primary to-cyber-secondary text-cyber-bg font-semibold py-3 px-4 rounded-lg flex items-center justify-center gap-2 hover:shadow-lg hover:shadow-cyber-primary/50 transition-all"
        >
          <Plus className="w-5 h-5" />
          AGREGAR DESCARGA POR SEGMENTOS
        </button>
      ) : (
        <div className="bg-cyber-surface border border-cyber-border rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <Link className="w-4 h-4 text-cyber-primary" />
            <span className="text-sm font-semibold">NUEVA DESCARGA HTTP</span>
          </div>
          {warning && (
            <div className="mb-3 flex items-start gap-2 rounded-lg border border-yellow-500/50 bg-yellow-500/10 p-2 text-xs text-yellow-400">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>{warning}</span>
            </div>
          )}
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="https://ejemplo.com/archivo.zip"
            className="w-full bg-cyber-bg border border-cyber-border rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-cyber-primary mb-3 font-mono"
            onKeyPress={(e) => e.key === 'Enter' && !loading && handleAdd()}
            disabled={loading}
          />
          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              disabled={loading}
              className="flex-1 bg-cyber-primary text-cyber-bg font-semibold py-2 rounded-lg hover:bg-cyber-secondary transition-colors disabled:opacity-50"
            >
              {loading ? 'VERIFICANDO...' : 'INICIAR DESCARGA'}
            </button>
            <button
              onClick={() => { setIsOpen(false); setInput('') }}
              className="px-4 py-2 bg-cyber-bg border border-cyber-border rounded-lg hover:border-cyber-error transition-colors"
              disabled={loading}
            >
              CANCELAR
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
