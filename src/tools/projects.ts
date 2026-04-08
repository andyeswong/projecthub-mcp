import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { api } from '../api/client.js'

export function registerProjectTools(server: McpServer) {

  // ── List ──────────────────────────────────────────────────────────────
  server.tool(
    'project_list',
    `List projects in the current organization. Scoped to the agent's org automatically.
Use workspace filter to narrow by workspace slug.`,
    {
      status:    z.enum(['active', 'archived']).optional().default('active'),
      workspace: z.string().optional().describe('Workspace slug'),
      q:         z.string().optional().describe('Search by name or description'),
      sort:      z.enum(['name', 'created_at', 'updated_at']).optional().default('updated_at'),
    },
    async (params) => {
      const qs = new URLSearchParams(
        Object.fromEntries(
          Object.entries(params)
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => [k, String(v)])
        )
      ).toString()
      const result = await api.get(`/projects${qs ? '?' + qs : ''}`)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
    },
  )

  // ── Get ───────────────────────────────────────────────────────────────
  server.tool(
    'project_get',
    'Get a single project with task counts by status.',
    {
      id: z.string().uuid().describe('Project UUID'),
    },
    async ({ id }) => {
      const result = await api.get(`/projects/${id}`)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
    },
  )

  // ── Create ────────────────────────────────────────────────────────────
  server.tool(
    'project_create',
    'Create a new project inside a workspace.',
    {
      workspace_id: z.string().uuid().describe('Workspace UUID'),
      name:         z.string().describe('Project name'),
      description:  z.string().optional(),
      status:       z.enum(['active', 'archived']).optional().default('active'),
    },
    async (body) => {
      const result = await api.post('/projects', body)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
    },
  )

  // ── Update ────────────────────────────────────────────────────────────
  server.tool(
    'project_update',
    'Update project name, description, or status.',
    {
      id:          z.string().uuid().describe('Project UUID'),
      name:        z.string().optional(),
      description: z.string().optional(),
      status:      z.enum(['active', 'archived']).optional(),
    },
    async ({ id, ...body }) => {
      const result = await api.patch(`/projects/${id}`, body)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
    },
  )

  // ── Workspaces ────────────────────────────────────────────────────────
  server.tool(
    'workspace_list',
    'List workspaces in an organization.',
    {
      org_slug: z.string().describe('Organization slug'),
    },
    async ({ org_slug }) => {
      const result = await api.get(`/organizations/${org_slug}/workspaces`)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
    },
  )

  server.tool(
    'workspace_create',
    'Create a new workspace inside an organization.',
    {
      org_slug: z.string().describe('Organization slug'),
      name:     z.string().describe('Workspace name'),
      slug:     z.string().optional().describe('URL-friendly slug (auto-generated if omitted)'),
    },
    async ({ org_slug, ...body }) => {
      const result = await api.post(`/organizations/${org_slug}/workspaces`, body)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
    },
  )
}
