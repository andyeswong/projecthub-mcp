import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { type ApiClient } from '../api/client.js'

export function registerSessionTools(server: McpServer, api: ApiClient) {

  // ── List (WARMUP) ───────────────────────────────────────────────────────
  server.tool(
    'session_list',
    `WARMUP — list your recent/relevant past sessions so you can offer to resume.
Scoped to the PILOT (all your agents), not just this token, when the token is
merged under a pilot. Call this at session start; if a relevant session has open
threads, ASK the user "want to continue <title>?" before starting fresh.
Pass q=<topic> for relevance ranking (semantic), open_only=true for unfinished work.`,
    {
      q:           z.string().optional().describe('Topic to relevance-rank against (semantic). Omit for pure recency.'),
      limit:       z.number().int().min(1).max(50).optional().default(5),
      status:      z.enum(['active', 'paused', 'done']).optional(),
      open_only:   z.boolean().optional().describe('Only sessions with unfinished open_threads'),
      external_id: z.string().optional().describe('Current host session id — pass it to exclude the current session from the list'),
    },
    async (params) => {
      const qs = new URLSearchParams(
        Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]))
      ).toString()
      const result = await api.get(`/sessions${qs ? '?' + qs : ''}`)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
    },
  )

  // ── Resume ──────────────────────────────────────────────────────────────
  server.tool(
    'session_resume',
    `Resume a past session: returns its verbatim summary + open_threads + a
CONSOLIDATED "where we left off" briefing (the consolidator over the session
and its linked memories) + the linked memory ids. Use after the user picks a
session from session_list. Start work from open_threads.`,
    {
      id: z.string().uuid().describe('Session UUID from session_list'),
    },
    async ({ id }) => {
      const result = await api.get(`/sessions/${id}/resume`)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
    },
  )

  // ── Checkpoint ──────────────────────────────────────────────────────────
  server.tool(
    'session_checkpoint',
    `Save/update a compact record of THIS session so it can be resumed later
(compress at write, not at read). Call when wrapping up meaningful work, or when
leaving threads unfinished. Idempotent per (token, external_id) — calling again
updates the same record. Write a useful summary (decisions + state) and list
open_threads (what's unfinished) — those drive the resume offer next time.
Secrets in the summary are scrubbed server-side.`,
    {
      external_id:       z.string().describe('Stable id for this run (e.g. the host/Claude Code session id)'),
      summary:           z.string().describe('Compact gist: what this session did, decisions made, current state'),
      title:             z.string().optional().describe('Short title, e.g. "Consolidator + rich memory build"'),
      open_threads:      z.array(z.string()).optional().describe('Unfinished work items — these trigger the resume offer'),
      linked_memory_ids: z.array(z.string().uuid()).optional().describe('Memories created/touched this session'),
      linked_task_ids:   z.array(z.string()).optional(),
      status:            z.enum(['active', 'paused', 'done']).optional().describe('done = finished; paused/active = resumable'),
      cwd:               z.string().optional().describe('Working directory'),
    },
    async (body) => {
      const result = await api.post('/sessions/checkpoint', body)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
    },
  )
}
