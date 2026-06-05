import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SubscribeRequestSchema, UnsubscribeRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { registerAllTools, resolveApi } from './server.js'

const INBOX_URI = 'projecthub://inbox'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Stateful "live" server: same tool surface as the stateless one, PLUS the
 * agent inbox exposed as a subscribable MCP resource. When a client subscribes,
 * a single server-side long-poll loop bridges the backend's Postgres
 * LISTEN/NOTIFY delivery into `notifications/resources/updated` pushes — so a
 * subscribed runtime is notified the instant a message/handshake arrives,
 * without polling. The bridge is torn down on unsubscribe and on session close.
 *
 * This is opt-in via the separate /mcp/live endpoint; the stateless /mcp the
 * fleet uses is untouched.
 */
export function createLiveServer(token?: string, baseUrl?: string): McpServer {
  const server = new McpServer(
    { name: 'projecthub-llm', version: '1.0.0' },
    { capabilities: { resources: { subscribe: true } } },
  )
  const api = resolveApi(token, baseUrl)
  registerAllTools(server, api)

  // Inbox as a readable resource.
  server.registerResource(
    'inbox',
    INBOX_URI,
    {
      title:       'Agent inbox',
      description: 'Your unread directed messages + pending handshakes. Subscribe to be notified the instant one arrives — no polling.',
      mimeType:    'application/json',
    },
    async (uri) => ({
      contents: [{
        uri:      uri.href,
        mimeType: 'application/json',
        text:     JSON.stringify(await api.get('/agents/inbox')),
      }],
    }),
  )

  // ── Bridge: REST long-poll (NOTIFY-backed) -> MCP resource update push ──────
  let bridgeStop: (() => void) | null = null

  const startBridge = () => {
    if (bridgeStop) return // already running for this session
    let stopped = false
    let lastSeen = '' // max message created_at already pushed (de-dupe / anti-spin)

    void (async () => {
      while (!stopped) {
        let emitted = false
        try {
          const res = await api.get<{
            messages?: Array<{ created_at: string }>
            pending_links?: unknown[]
          }>('/agents/inbox?wait=25')
          if (stopped) break

          const msgs = res.messages ?? []
          const pending = res.pending_links ?? []
          const latest = msgs.reduce((m, x) => (x.created_at > m ? x.created_at : m), '')
          const isFresh = (latest !== '' && latest > lastSeen) || pending.length > 0

          if (isFresh) {
            lastSeen = latest || lastSeen
            emitted = true
            await server.server.sendResourceUpdated({ uri: INBOX_URI })
          }
        } catch {
          if (stopped) break
          await sleep(2000) // transient backend/network error — back off
          continue
        }
        // Stale unread makes the long-poll return immediately; pause briefly when
        // we did not emit, to avoid a hot loop until the client reads/acks.
        if (!emitted) await sleep(1500)
      }
    })()

    bridgeStop = () => { stopped = true }
  }

  const stopBridge = () => {
    if (bridgeStop) { bridgeStop(); bridgeStop = null }
  }

  // Subscribe / unsubscribe (McpServer does not claim these handlers).
  server.server.setRequestHandler(SubscribeRequestSchema, async (req) => {
    if (req.params.uri === INBOX_URI) startBridge()
    return {}
  })
  server.server.setRequestHandler(UnsubscribeRequestSchema, async (req) => {
    if (req.params.uri === INBOX_URI) stopBridge()
    return {}
  })

  // Tear down the bridge when the session/connection closes (leak safety).
  const prevOnClose = server.server.onclose
  server.server.onclose = () => { stopBridge(); prevOnClose?.() }

  return server
}
