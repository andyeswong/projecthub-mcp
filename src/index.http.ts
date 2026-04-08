import express from 'express'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createServer } from './server.js'

const app     = express()
const BASE_URL = (process.env.PROJECTHUB_BASE_URL ?? '').replace(/\/$/, '')
const PORT    = parseInt(process.env.PORT ?? '3000', 10)

if (!BASE_URL) {
  console.error('PROJECTHUB_BASE_URL env var is required')
  process.exit(1)
}

app.use(express.json())

// Health check — useful for load balancers / uptime monitors
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', server: 'projecthub-mcp', transport: 'http' })
})

// MCP endpoint — each request carries the agent's own Bearer token
app.all('/mcp', async (req, res) => {
  // Extract the agent's ProjectHub API key from the Authorization header
  const authHeader = (req.headers['authorization'] ?? '') as string
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()

  if (!token || !token.startsWith('sk_proj_')) {
    res.status(401).json({
      error:  'Missing or invalid Authorization header.',
      hint:   'Include your ProjectHub API key: Authorization: Bearer sk_proj_...',
      obtain: `POST ${BASE_URL}/auth/register`,
    })
    return
  }

  try {
    // Each request gets its own server instance scoped to the agent's token
    const server    = createServer(token, BASE_URL)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless — no session tracking needed
    })

    await server.connect(transport)
    await transport.handleRequest(req, res, req.body)
  } catch (err) {
    console.error('MCP request error:', err)
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal MCP server error' })
    }
  }
})

app.listen(PORT, () => {
  console.error(`ProjectHub MCP HTTP server listening on port ${PORT}`)
  console.error(`MCP endpoint: http://0.0.0.0:${PORT}/mcp`)
  console.error(`Base API:     ${BASE_URL}`)
})
