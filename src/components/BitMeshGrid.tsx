import { Zap, Grid3x3 } from 'lucide-react'
import { Segment } from '../types'

interface BitMeshGridProps {
  segments: Segment[]
}

export default function BitMeshGrid({ segments }: BitMeshGridProps) {
  const getSegmentColor = (segment: Segment) => {
    if (segment.downloaded) return 'bg-cyber-primary'
    if (segment.inProgress) return 'bg-cyber-secondary animate-pulse'
    if (segment.error) return 'bg-cyber-error'
    return 'bg-cyber-border'
  }

  return (
    <div className="bg-cyber-surface border border-cyber-border rounded-lg overflow-hidden">
      <div className="p-3 border-b border-cyber-border bg-cyber-bg/50 flex items-center gap-2">
        <Grid3x3 className="w-4 h-4 text-cyber-primary" />
        <h2 className="text-sm font-semibold">BITMESH - MAPA DE BLOQUES (HTTP POR SEGMENTOS)</h2>
        <div className="ml-auto flex items-center gap-3 text-xs">
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 bg-cyber-primary rounded-sm" />
            <span className="text-gray-500">COMPLETO</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 bg-cyber-secondary rounded-sm animate-pulse" />
            <span className="text-gray-500">DESCARGANDO</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 bg-cyber-border rounded-sm" />
            <span className="text-gray-500">PENDIENTE</span>
          </div>
        </div>
      </div>

      <div className="p-4">
        <div className="grid grid-cols-16 md:grid-cols-32 lg:grid-cols-48 gap-1 max-h-56 overflow-y-auto">
          {segments.map((segment) => (
            <div
              key={segment.index}
              className={`h-3 rounded-sm transition-all duration-200 ${getSegmentColor(segment)} ${segment.downloaded || segment.inProgress ? 'opacity-100' : 'opacity-60'}`}
              title={`Segmento #${segment.index} | bytes ${segment.start.toString()}-${segment.end.toString()} | ${(segment.progress * 100).toFixed(0)}%`}
            />
          ))}
        </div>
        <div className="mt-3 flex justify-between text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <Zap className="w-3 h-3 text-cyber-primary" />
            TOTAL: {segments.length} SEGMENTOS
          </span>
          <span>COMPLETADOS: {segments.filter(s => s.downloaded).length}/{segments.length}</span>
          <span>EN PROCESO: {segments.filter(s => s.inProgress).length}</span>
        </div>
      </div>
    </div>
  )
}
