import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createApiClient, api as envApi } from './api/client.js'
import { registerMemoryTools }  from './tools/memory.js'
import { registerTaskTools }    from './tools/tasks.js'
import { registerProjectTools } from './tools/projects.js'
import { registerEventTools }   from './tools/events.js'
import { registerCommentTools } from './tools/comments.js'

export function createServer(token?: string, baseUrl?: string): McpServer {
  const server = new McpServer({
    name:    'projecthub-llm',
    version: '1.0.0',
  })

  // Use provided credentials (HTTP mode) or fall back to env vars (stdio mode)
  const api = token && baseUrl
    ? createApiClient(token, baseUrl)
    : envApi

  // ── Identity ─────────────────────────────────────────────────────────
  server.tool(
    'whoami',
    `Get the current agent's identity, permissions, and rate limit status.
Call this first to confirm your API key is valid and learn your org_id, workspace_id, and permission set.`,
    {},
    async () => {
      const result = await api.get('/auth/me')
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
    },
  )

  server.tool(
    'pilot_token_create',
    `Generate a one-time login token for the human pilot. Valid for 15 minutes, single-use.
Share the login URL: https://your-host/login?token=plt_...`,
    {},
    async () => {
      const result = await api.post('/auth/pilot-token')
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
    },
  )

  server.tool(
    'org_list',
    'List organizations accessible to the current API key.',
    {},
    async () => {
      const result = await api.get('/organizations')
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
    },
  )

  // Register tool groups — pass the api client so HTTP mode works per-request
  registerMemoryTools(server, api)
  registerTaskTools(server, api)
  registerProjectTools(server, api)
  registerEventTools(server, api)
  registerCommentTools(server, api)

  return server
}
