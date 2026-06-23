import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { type ApiClient } from '../api/client.js'

export function registerMemoryTools(server: McpServer, api: ApiClient) {

  // ── Search ────────────────────────────────────────────────────────────
  server.tool(
    'memory_search',
    `Semantic vector search across org memories using mxbai-embed-large embeddings.
By default searches ALL workspaces in the org. Pass workspace_id to narrow scope.
Returns results ranked by similarity score (0.0–1.0). Score ≥ 0.75 is a strong match.
Falls back to keyword search if the embedding service is unreachable.
Use this BEFORE storing a new memory to check if it already exists.
Use this to retrieve any previously stored context: credentials, IPs, domains, facts, skills.`,
    {
      q:            z.string().min(2).describe('Natural language query, e.g. "production database password" or "deploy skill for Laravel"'),
      limit:        z.number().int().min(1).max(50).optional().default(10).describe('Max results to return (default 10)'),
      workspace_id: z.string().uuid().optional().describe('Limit search to a specific workspace UUID. Omit to search all workspaces in the org.'),
    },
    async ({ q, limit, workspace_id }) => {
      const result = await api.post('/memory/search', { q, limit, workspace_id })
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
    },
  )

  // ── Consolidate (⚠️ EXPERIMENTAL) ───────────────────────────────────────
  server.tool(
    'memory_consolidate',
    `⚠️ EXPERIMENTAL — Retrieve memories like memory_search, but return ONE consolidated
KNOWLEDGE block (rules + references + gotchas + provenance) instead of N raw memories.
Runs the matched memories through an LLM knowledge-consolidator (server-configured,
prod default DeepSeek deepseek-v4-flash) that generalizes recurring patterns into
applicable rules and strips redundancy — typically ~10x fewer tokens than the raw set.

This does NOT replace memory_search; the raw memories are untouched and returned in
'provenance'. Output is LOSSY by design (drops examples/restated detail) — treat it as a
CANDIDATE for human review. Sensitive memory content is masked before it reaches the LLM
(secrets appear as [vault:mask]). Returns 503 if the consolidator is disabled server-side.`,
    {
      q:            z.string().min(2).describe('Natural language query — same as memory_search. The memories it matches get consolidated.'),
      limit:        z.number().int().min(1).max(50).optional().default(10).describe('Max memories to retrieve and consolidate (default 10)'),
      workspace_id: z.string().uuid().optional().describe('Limit to a specific workspace UUID. Omit to search all workspaces in the org.'),
      model:        z.string().optional().describe('Override consolidator model. Default deepseek-flash (fast). Pass "deepseek-pro" for higher quality (slower, ~35s — may time out on big sets).'),
    },
    async ({ q, limit, workspace_id, model }) => {
      const result = await api.post('/memory/consolidate', { q, limit, workspace_id, model })
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
    },
  )

  // ── Store ─────────────────────────────────────────────────────────────
  server.tool(
    'memory_store',
    `Store a new memory in the org. Automatically embedded for future semantic search.
All agents in the same org can read this memory regardless of model (Claude, GPT-4, Gemini, etc.).
Pass workspace_id to store into a specific workspace; omits defaults to the first workspace in the org.
Types: credential, domain, ip, fact, config, note, skill, other.
Use is_sensitive=true for passwords, tokens, or secrets — value and content masked in list views.
Use a key for memories you will update later (e.g. "prod-db-password", "main-api-url").`,
    {
      label:        z.string().describe('Short human-readable label, e.g. "Production DB password"'),
      content:      z.string().describe('Descriptive text used for embedding and search. Describe what this memory is and when to use it.'),
      type:         z.enum(['credential', 'domain', 'ip', 'fact', 'config', 'note', 'skill', 'other']).default('fact'),
      workspace_id: z.string().uuid().optional().describe('Target workspace UUID. Defaults to the first workspace in the org if omitted.'),
      key:          z.string().optional().describe('Optional named key for direct retrieval or future updates. Must be unique within the target workspace.'),
      value:        z.record(z.unknown()).optional().describe('Structured data, e.g. { username: "admin", password: "secret", host: "db.prod" }'),
      tags:         z.array(z.string()).optional().describe('Tags for grouping, e.g. ["prod", "mysql", "backend"]'),
      is_sensitive: z.boolean().optional().default(false).describe('Set true for passwords, tokens, secrets. Masks content and value in list/search responses.'),
      expires_at:   z.string().optional().describe('ISO 8601 datetime after which this memory is excluded from search/list'),
    },
    async (args) => {
      const result = await api.post('/memory', args)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
    },
  )

  // ── Upsert by key ─────────────────────────────────────────────────────
  server.tool(
    'memory_upsert',
    `Create or update a memory by named key. Idempotent — safe to call multiple times.
If the key exists in the target workspace, updates it and re-embeds if content changed.
If the key does not exist, creates it.
Pass workspace_id to scope the upsert to a specific workspace; defaults to the first workspace.
Preferred over memory_store for memories that change over time (e.g. current deploy version, active config).`,
    {
      key:          z.string().describe('Named key unique within the target workspace, e.g. "prod-db-password", "current-sprint"'),
      workspace_id: z.string().uuid().optional().describe('Target workspace UUID. Defaults to the first workspace in the org if omitted.'),
      label:        z.string().optional().describe('Short human-readable label'),
      content:      z.string().optional().describe('Descriptive text for embedding. Required on first create.'),
      type:         z.enum(['credential', 'domain', 'ip', 'fact', 'config', 'note', 'skill', 'other']).optional(),
      value:        z.record(z.unknown()).optional().describe('Structured data'),
      tags:         z.array(z.string()).optional(),
      is_sensitive: z.boolean().optional(),
      expires_at:   z.string().optional().describe('ISO 8601 datetime'),
    },
    async ({ key, ...body }) => {
      const result = await api.put(`/memory/key/${encodeURIComponent(key)}`, body)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
    },
  )

  // ── List ──────────────────────────────────────────────────────────────
  server.tool(
    'memory_list',
    `List org memories with optional filters.
By default returns memories from ALL workspaces. Pass workspace_id to narrow to one workspace.
Use memory_search for finding memories by meaning.
Use memory_list to browse by type, tag, or named key.`,
    {
      workspace_id: z.string().uuid().optional().describe('Filter to a specific workspace UUID. Omit for all org workspaces.'),
      type:         z.enum(['credential', 'domain', 'ip', 'fact', 'config', 'note', 'skill', 'other']).optional().describe('Filter by type'),
      tags:         z.string().optional().describe('Comma-separated tags to filter by'),
      key:          z.string().optional().describe('Retrieve a specific named memory by exact key'),
      q:            z.string().optional().describe('Keyword search on label, content, or key'),
      limit:        z.number().int().min(1).max(100).optional().default(50),
    },
    async (params) => {
      const qs = new URLSearchParams(
        Object.fromEntries(
          Object.entries(params)
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => [k, String(v)])
        )
      ).toString()
      const result = await api.get(`/memory${qs ? '?' + qs : ''}`)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
    },
  )

  // ── Get ───────────────────────────────────────────────────────────────
  server.tool(
    'memory_get',
    'Retrieve a single memory by ID with its full unmasked value. Use this to reveal sensitive data like passwords or tokens.',
    {
      id: z.string().uuid().describe('Memory UUID'),
    },
    async ({ id }) => {
      const result = await api.get(`/memory/${id}`)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
    },
  )

  // ── Update ────────────────────────────────────────────────────────────
  server.tool(
    'memory_update',
    `Update a memory by ID. Re-embeds automatically if content changes.
Pass workspace_id to move the memory to a different workspace within the same org.`,
    {
      id:           z.string().uuid().describe('Memory UUID'),
      workspace_id: z.string().uuid().optional().describe('Move memory to this workspace UUID (must belong to the same org)'),
      label:        z.string().optional(),
      content:      z.string().optional(),
      type:         z.enum(['credential', 'domain', 'ip', 'fact', 'config', 'note', 'skill', 'other']).optional(),
      value:        z.record(z.unknown()).optional(),
      tags:         z.array(z.string()).optional(),
      is_sensitive: z.boolean().optional(),
      expires_at:   z.string().optional(),
    },
    async ({ id, ...body }) => {
      const result = await api.put(`/memory/${id}`, body)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
    },
  )

  // ── Integrate (complement, not replace) ─────────────────────────────────
  server.tool(
    'memory_integrate',
    `COMPLEMENT an existing memory — append new info / a correction WITHOUT overwriting.
Use this (not memory_update) when reality refined a memory: a correction, a better way,
or an error-trail ("the obvious X failed, the real one is Y"). The original content is
PRESERVED; your note is appended and recorded in integration_log, and reinforced_count
bumps (the repetition signal). This is "memories integrate, not replace" — the error-trail
is kept because it pre-empts the same mistake next time, and it's where local procedural
know-how accrues. Optionally attach origin (where this was learned) and associations
(weighted edges to related memories for spreading-activation).`,
    {
      id:           z.string().uuid().describe('Memory UUID to complement'),
      note:         z.string().min(1).describe('The new info / correction / error-trail to integrate. e.g. "PAT ghp_… is expired; the live one is in vault X" or "tried port 8080, it was 8099"'),
      origin:       z.string().optional().describe('Where this was learned, e.g. "from Tim 2026-06", "hit in prod deploy"'),
      associations: z.array(z.object({
        id:     z.string().uuid().describe('Related memory UUID'),
        weight: z.number().optional().describe('Edge strength 0–1 (higher = auto-fires more readily)'),
        note:   z.string().optional().describe('Why related'),
      })).optional().describe('Weighted edges to related memories (spreading-activation)'),
    },
    async ({ id, ...body }) => {
      const result = await api.post(`/memory/${id}/integrate`, body)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
    },
  )

  // ── Delete ────────────────────────────────────────────────────────────
  server.tool(
    'memory_delete',
    'Permanently delete a memory by ID. Emits a memory.deleted event.',
    {
      id: z.string().uuid().describe('Memory UUID'),
    },
    async ({ id }) => {
      const result = await api.delete(`/memory/${id}`)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
    },
  )
}
