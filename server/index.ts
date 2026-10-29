import express from 'express'
import cors from 'cors'
import { WebSocketServer } from 'ws'
import http from 'http'
import { Readable } from 'stream'

const app = express()
const server = http.createServer(app)
const wss = new WebSocketServer({ server })

const configuredOrigins = (process.env.CORS_ORIGIN || process.env.FRONTEND_URL || '')
  .split(',')
  .map((origin) => origin.trim().replace(/\/+$/, ''))
  .filter(Boolean)

const defaultOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3001',
  'http://127.0.0.1:3001'
]

const allowedOrigins = new Set([...defaultOrigins, ...configuredOrigins])
const allowAllOrigins = configuredOrigins.includes('*')

app.set('trust proxy', 1)

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) {
      return callback(null, true)
    }
    const normalizedOrigin = origin.replace(/\/+$/, '')
    const isRenderFrontend = /^https:\/\/[a-z0-9-]+\.onrender\.com$/i.test(normalizedOrigin)
    if (allowAllOrigins || allowedOrigins.has(normalizedOrigin) || isRenderFrontend) {
      return callback(null, true)
    }
    return callback(null, false)
  },
  credentials: true,
  methods: ['GET', 'HEAD', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Range', 'Accept', 'Origin'],
  exposedHeaders: [
    'Content-Length',
    'Content-Range',
    'Accept-Ranges',
    'Content-Disposition',
    'Content-Type'
  ],
  optionsSuccessStatus: 204,
  maxAge: 86400
}))
app.use(express.json())

app.get('/', (_req, res) => {
  res.json({
    status: 'online',
    service: 'chop-p2p-downloader',
    timestamp: Date.now()
  })
})

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() })
})

// Ensure all API responses are JSON
app.use('/api', (req, res, next) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  next()
})

app.get('/api/status', (req, res) => {
  res.json({ 
    status: 'online',
    peers: wss.clients.size,
    timestamp: Date.now()
  })
})

function extractFilename(url: string, contentDisposition?: string | null): string {
  if (contentDisposition) {
    const filenameStarMatch = contentDisposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)
    if (filenameStarMatch && filenameStarMatch[1]) {
      try {
        return decodeURIComponent(filenameStarMatch[1])
      } catch {
        return filenameStarMatch[1]
      }
    }
    const filenameMatch = contentDisposition.match(/filename\s*=\s*"([^"]+)"|filename\s*=\s*([^;]+)/i)
    if (filenameMatch) {
      const name = filenameMatch[1] || filenameMatch[2]
      if (name) {
        try {
          return decodeURIComponent(name.trim())
        } catch {
          return name.trim()
        }
      }
    }
  }

  try {
    const parsedUrl = new URL(url)
    const pathname = parsedUrl.pathname
    const segments = pathname.split('/').filter(Boolean)
    if (segments.length > 0) {
      const lastSegment = segments[segments.length - 1]
      try {
        return decodeURIComponent(lastSegment)
      } catch {
        return lastSegment
      }
    }
  } catch {
    // ignore
  }

  return 'descarga'
}

app.get('/api/verify', async (req, res) => {
  try {
    const url = req.query.url as string

    if (!url) {
      return res.status(400).json({ error: 'URL requerida' })
    }

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return res.status(400).json({ error: 'URL HTTP/HTTPS inválida' })
    }
    let headResponse: Response | null = null
    try {
      headResponse = await fetch(url, { method: 'HEAD' })
    } catch {
      headResponse = null
    }

    let acceptRangesHeader: string | null = null
    let contentLengthHeader: string | null = null
    let contentDispositionHeader: string | null = null
    let contentTypeHeader: string | null = null

    if (headResponse) {
      acceptRangesHeader = headResponse.headers.get('accept-ranges')
      contentLengthHeader = headResponse.headers.get('content-length')
      contentDispositionHeader = headResponse.headers.get('content-disposition')
      contentTypeHeader = headResponse.headers.get('content-type')
    }

    let acceptsRanges = acceptRangesHeader === 'bytes'
    let contentLength = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 0

    if ((!acceptsRanges || contentLength <= 0) && headResponse) {
      try {
        const rangeResponse = await fetch(url, {
          method: 'GET',
          headers: { Range: 'bytes=0-0' }
        })
        const rangeSupportedByStatus = rangeResponse.status === 206
        const rangeAcceptHeader = rangeResponse.headers.get('accept-ranges')
        if (rangeSupportedByStatus || rangeAcceptHeader === 'bytes') {
          acceptsRanges = true
        }
        if ((!contentLength || contentLength <= 0)) {
          const cl = rangeResponse.headers.get('content-length')
          if (cl) {
            contentLength = parseInt(cl, 10)
          } else {
            const cr = rangeResponse.headers.get('content-range')
            if (cr) {
              const match = cr.match(/\/(\d+)/)
              if (match && match[1]) {
                contentLength = parseInt(match[1], 10)
              }
            }
          }
        }
        if (!contentDispositionHeader) {
          contentDispositionHeader = rangeResponse.headers.get('content-disposition')
        }
        if (!contentTypeHeader) {
          contentTypeHeader = rangeResponse.headers.get('content-type')
        }
        try {
          rangeResponse.body?.cancel()
        } catch {
          // ignore
        }
      } catch {
        // ignore
      }
    }

    if ((!acceptsRanges || contentLength <= 0)) {
      try {
        const getResponse = await fetch(url, { method: 'GET' })
        const rangeAcceptHeader = getResponse.headers.get('accept-ranges')
        if (rangeAcceptHeader === 'bytes') {
          acceptsRanges = true
        }
        if (!contentLength || contentLength <= 0) {
          const cl = getResponse.headers.get('content-length')
          if (cl) {
            contentLength = parseInt(cl, 10)
          }
        }
        if (!contentDispositionHeader) {
          contentDispositionHeader = getResponse.headers.get('content-disposition')
        }
        if (!contentTypeHeader) {
          contentTypeHeader = getResponse.headers.get('content-type')
        }
        try {
          getResponse.body?.cancel()
        } catch {
          // ignore
        }
      } catch {
        // ignore
      }
    }

    const filename = extractFilename(url, contentDispositionHeader)

    return res.json({
      acceptsRanges,
      contentLength: isNaN(contentLength) ? 0 : Number(contentLength),
      filename,
      contentType: contentTypeHeader || undefined
    })
  } catch (error) {
    return res.status(500).json({
      error: 'No se pudo verificar si el servidor soporta descargas por rangos'
    })
  }
})

app.get('/api/download', async (req, res) => {
  try {
    const url = req.query.url as string
    const range = req.headers.range as string | undefined

    if (!url) {
      return res.status(400).json({ error: 'URL requerida' })
    }

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return res.status(400).json({ error: 'URL HTTP/HTTPS inválida' })
    }

    const headers: Record<string, string> = {}
    if (range) {
      headers['Range'] = range
    }

    const isHeadRequest = req.method === 'HEAD'
    let upstream = await fetch(url, {
      method: isHeadRequest ? 'HEAD' : 'GET',
      headers
    })

    if (isHeadRequest && (upstream.status === 405 || upstream.status === 501)) {
      try {
        upstream.body?.cancel()
      } catch {
        // ignore
      }
      upstream = await fetch(url, { method: 'GET', headers })
    }

    res.status(upstream.status)

    const contentType = upstream.headers.get('content-type')
    if (contentType) res.setHeader('Content-Type', contentType)
    const contentLength = upstream.headers.get('content-length')
    if (contentLength) res.setHeader('Content-Length', contentLength)
    const contentRange = upstream.headers.get('content-range')
    if (contentRange) res.setHeader('Content-Range', contentRange)
    const acceptRanges = upstream.headers.get('accept-ranges')
    if (acceptRanges) {
      res.setHeader('Accept-Ranges', acceptRanges)
    } else if (upstream.status === 206) {
      res.setHeader('Accept-Ranges', 'bytes')
    }
    const contentDisposition = upstream.headers.get('content-disposition')
    if (contentDisposition) res.setHeader('Content-Disposition', contentDisposition)

    if (isHeadRequest) {
      try {
        upstream.body?.cancel()
      } catch {
        // ignore
      }
      res.end()
      return
    }

    if (upstream.body) {
      const reader = upstream.body.getReader()
      const stream = new Readable({
        async read() {
          try {
            const { done, value } = await reader.read()
            if (done) {
              this.push(null)
              return
            }
            if (value) {
              this.push(Buffer.from(value))
            } else {
              this.push(null)
            }
          } catch (e) {
            this.destroy(e as Error)
          }
        }
      })
      stream.pipe(res)
      return
    }

    res.end()
  } catch (error: any) {
    if (!res.headersSent) {
      return res.status(502).json({ error: error?.message || 'Error al proxy descargar' })
    }
    try {
      res.end()
    } catch {}
  }
})

wss.on('connection', (ws) => {
  console.log('Peer connected')
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString())
      console.log('Message:', data.type)
    } catch (e) {
      console.error('Invalid message')
    }
  })
  
  ws.on('close', () => {
    console.log('Peer disconnected')
  })
})

// Catch-all for API routes - return JSON 404
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Endpoint no encontrado' })
})

// Global error handler - always return JSON
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err)
  res.status(err.status || 500).json({
    error: err.message || 'Error interno del servidor'
  })
})

const PORT = Number(process.env.PORT) || 3001
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Chop P2P Signaling Server running on port ${PORT}`)
})
