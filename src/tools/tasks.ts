import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { api } from '../api/client.js'

const TaskStatus   = z.enum(['backlog', 'todo', 'in_progress', 'done', 'blocked'])
const TaskPriority = z.enum(['low', 'medium', 'high', 'critical'])

export function registerTaskTools(server: McpServer) {

  // ── List ──────────────────────────────────────────────────────────────
  server.tool(
    'task_list',
    `List tasks in a project. Supports filtering by status, assignee, and priority.
Use status="open" as shorthand for all non-done tasks.
Use assignee="me" to get tasks assigned to the current agent.`,
    {
      project_id:       z.string().uuid().describe('Project UUID'),
      status:           z.union([TaskStatus, z.literal('open')]).optional().describe('"open" returns all non-done. Otherwise: backlog, todo, in_progress, done, blocked'),
      assignee:         z.string().optional().describe('"me", "unassigned", or an agent UUID'),
      priority:         z.string().optional().describe('Comma-separated: low,medium,high,critical'),
      q:                z.string().optional().describe('Search by title or description'),
      include_archived: z.boolean().optional().default(false),
      limit:            z.number().int().min(1).max(100).optional().default(50),
    },
    async ({ project_id, ...params }) => {
      const qs = new URLSearchParams(
        Object.fromEntries(
          Object.entries(params)
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => [k, String(v)])
        )
      ).toString()
      const result = await api.get(`/projects/${project_id}/tasks${qs ? '?' + qs : ''}`)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
    },
  )

  // ── Create ────────────────────────────────────────────────────────────
  server.tool(
    'task_create',
    `Create a single task in a project.
Use assignee_id="me" to self-assign.
Returns the full task object with ID for future updates.`,
    {
      project_id:       z.string().uuid().describe('Project UUID'),
      title:            z.string().describe('Task title — concise and action-oriented'),
      description:      z.string().optional().describe('Detailed description, acceptance criteria, or context'),
      status:           TaskStatus.optional().default('backlog'),
      priority:         TaskPriority.optional().default('medium'),
      assignee_id:      z.string().optional().describe('Agent UUID or "me" for self-assign'),
      due_date:         z.string().optional().describe('YYYY-MM-DD'),
      start_date:       z.string().optional().describe('YYYY-MM-DD'),
      estimated_hours:  z.number().optional(),
      tags:             z.array(z.string()).optional(),
    },
    async ({ project_id, ...body }) => {
      const result = await api.post(`/projects/${project_id}/tasks`, body)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
    },
  )

  // ── Batch create ──────────────────────────────────────────────────────
  server.tool(
    'task_batch',
    `Create up to 50 tasks in a single request. Much faster than calling task_create in a loop.
Returns the list of created task IDs and any failures.
Ideal for decomposing a project into its initial task set.`,
    {
      project_id: z.string().uuid().describe('Project UUID'),
      tasks: z.array(z.object({
        title:           z.string(),
        description:     z.string().optional(),
        status:          TaskStatus.optional(),
        priority:        TaskPriority.optional(),
        assignee_id:     z.string().optional(),
        due_date:        z.string().optional(),
        estimated_hours: z.number().optional(),
        tags:            z.array(z.string()).optional(),
      })).min(1).max(50).describe('Array of task objects'),
    },
    async ({ project_id, tasks }) => {
      const result = await api.post(`/projects/${project_id}/tasks/batch`, { tasks })
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
    },
  )

  // ── Get ───────────────────────────────────────────────────────────────
  server.tool(
    'task_get',
    'Get full task detail including comments and activity timeline.',
    {
      id: z.string().uuid().describe('Task UUID'),
    },
    async ({ id }) => {
      const result = await api.get(`/tasks/${id}`)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
    },
  )

  // ── Update ────────────────────────────────────────────────────────────
  server.tool(
    'task_update',
    `Update task fields. All fields are optional — only send what changes.
Pass project_id to move the task to a different project within the same org (emits task.moved).
Status changes are automatically recorded in the event log.`,
    {
      id:              z.string().uuid().describe('Task UUID'),
      title:           z.string().optional(),
      description:     z.string().optional(),
      status:          TaskStatus.optional(),
      priority:        TaskPriority.optional(),
      assignee_id:     z.string().optional().describe('Agent UUID or null to unassign'),
      due_date:        z.string().optional().describe('YYYY-MM-DD or null to clear'),
      estimated_hours: z.number().optional(),
      tags:            z.array(z.string()).optional(),
      project_id:      z.string().uuid().optional().describe('Move to another project by passing destination UUID'),
    },
    async ({ id, ...body }) => {
      const result = await api.patch(`/tasks/${id}`, body)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
    },
  )

  // ── Archive ───────────────────────────────────────────────────────────
  server.tool(
    'task_archive',
    `Soft-delete a task. Archived tasks are hidden from task lists by default.
The reason is automatically saved as a comment in the task timeline.
Use task_unarchive to restore it.`,
    {
      id:     z.string().uuid().describe('Task UUID'),
      reason: z.string().optional().describe('Why this task is being archived — stored as a comment'),
    },
    async ({ id, reason }) => {
      const result = await api.post(`/tasks/${id}/archive`, { reason })
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
    },
  )

  // ── Unarchive ─────────────────────────────────────────────────────────
  server.tool(
    'task_unarchive',
    'Restore an archived task. Clears archived_at, archived_by, and archive_reason. Emits task.unarchived.',
    {
      id: z.string().uuid().describe('Task UUID'),
    },
    async ({ id }) => {
      const result = await api.post(`/tasks/${id}/unarchive`)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
    },
  )
}
