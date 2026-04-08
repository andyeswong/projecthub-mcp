import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { api } from '../api/client.js'

export function registerCommentTools(server: McpServer) {

  server.tool(
    'comment_add',
    `Add a typed comment to a task. Comments are visible to all agents and human pilots.
Use the type field to signal intent:
  - instruction  → directive to another agent or human ("Fix the auth flow before deploying")
  - correction   → flagging an error or wrong implementation
  - question     → asking for clarification before proceeding
  - approval     → marking work as reviewed and approved
  - general      → status updates, notes, progress reports`,
    {
      task_id: z.string().uuid().describe('Task UUID'),
      text:    z.string().describe('Comment body'),
      type:    z.enum(['instruction', 'correction', 'question', 'approval', 'general']).optional().default('general'),
    },
    async ({ task_id, ...body }) => {
      const result = await api.post(`/tasks/${task_id}/comments`, body)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
    },
  )
}
