import express from 'express'
import { randomUUID } from 'node:crypto'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import { createServer } from './server.js'
import { createLiveServer } from './live.js'

const app     = express()
const BASE_URL = (process.env.PROJECTHUB_BASE_URL ?? '').replace(/\/$/, '')
const PORT    = parseInt(process.env.PORT ?? '3000', 10)

if (!BASE_URL) {
  console.error('PROJECTHUB_BASE_URL env var is required')
  process.exit(1)
}

app.use(express.json())

const bearerToken = (req: express.Request): string =>
  ((req.headers['authorization'] ?? '') as string).replace(/^Bearer\s+/i, '').trim()

// Health check — accessible at /health or /mcp/health
app.get(['/health', '/mcp/health'], (_req, res) => {
  res.json({ status: 'ok', server: 'projecthub-mcp', transport: 'http' })
})

// ── Stateful "live" endpoint (opt-in, separate from the stateless /mcp) ───────
// Sessions are retained so the server can push notifications/resources/updated to
// a subscribed client (real-time inbox). The stateless /mcp below is unchanged,
// so the existing fleet is unaffected.
const liveTransports: Record<string, StreamableHTTPServerTransport> = {}

app.all('/mcp/live', async (req, res) => {
  const token = bearerToken(req)
  if (!token.startsWith('sk_proj_')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header (Bearer sk_proj_...).' })
    return
  }

  try {
    const sessionId = req.headers['mcp-session-id'] as string | undefined
    let transport = sessionId ? liveTransports[sessionId] : undefined

    if (!transport) {
      if (sessionId) {
        res.status(404).json({ error: 'Unknown or expired session id.' })
        return
      }
      if (!isInitializeRequest(req.body)) {
        res.status(400).json({ error: 'No session id; expected an initialize request to open one.' })
        return
      }
      const newTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => { liveTransports[id] = newTransport },
      })
      newTransport.onclose = () => {
        const id = newTransport.sessionId
        if (id) delete liveTransports[id]
      }
      // Bind this session to the agent's token for its lifetime.
      const server = createLiveServer(token, BASE_URL)
      await server.connect(newTransport)
      transport = newTransport
    }

    await transport.handleRequest(req, res, req.body)
  } catch (err) {
    console.error('MCP live request error:', err)
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal MCP live server error' })
    }
  }
})

// MCP endpoint — each request carries the agent's own Bearer token
app.all(['/mcp', '/'], async (req, res) => {
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
    // Spec compliance: strict MCP clients (e.g. Crush) require the server to
    // emit Mcp-Session-Id on the initialize response. This endpoint is stateless
    // (the SDK ignores any inbound session id), so the value is cosmetic — but it
    // lets strict clients finish the handshake instead of failing notifications/
    // initialized with "context canceled". The tolerant fleet (Claude Code) is
    // unaffected: it never sent a session id and stateless validateSession is a no-op.
    if (isInitializeRequest(req.body)) {
      res.setHeader('Mcp-Session-Id', randomUUID())
    }
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
  console.error(`MCP endpoint: http://0.0.0.0:${PORT}/mcp  (stateless)`)
  console.error(`MCP live:     http://0.0.0.0:${PORT}/mcp/live  (stateful, push)`)
  console.error(`Base API:     ${BASE_URL}`)
})
