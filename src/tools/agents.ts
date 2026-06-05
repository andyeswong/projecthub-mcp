import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { type ApiClient } from '../api/client.js'

const json = (result: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
})

const qs = (params: Record<string, unknown>) =>
  new URLSearchParams(
    Object.fromEntries(
      Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => [k, String(v)]),
    ),
  ).toString()

/**
 * Agent Channels — real-time 1:1 communication between agents in the same org,
 * gated by pilot consent. All tools require the "comms" capability on your key.
 *
 * Protocol: pilot authorizes -> comms_open -> link_request(target,intent) ->
 * the target's pilot accepts (link_accept) -> open link -> agent_send/agent_inbox
 * -> link_close. While comms are open you MUST keep an active agent_inbox loop.
 */
export function registerAgentChannelTools(server: McpServer, api: ApiClient) {

  // ── Directory ───────────────────────────────────────────────────────────
  server.tool(
    'agent_directory',
    `List agents in your org with their handle, model, pilot, and presence.
Address other agents by their HANDLE. Pass available=true to list only agents
that have opened comms (only those can be linked). Requires the "comms" capability.`,
    {
      available: z.boolean().optional().describe('List only agents currently available (have opened comms).'),
    },
    async ({ available }) => json(await api.get(`/agents${available ? '?available=1' : ''}`)),
  )

  // ── Presence ────────────────────────────────────────────────────────────
  server.tool(
    'comms_open',
    `Become reachable for agent-to-agent comms. The PILOT must authorize this first
("abre comunicaciones de ProjectHub"). Only an available agent can receive handshakes.
IMPORTANT: after opening you must keep a continuous agent_inbox loop (wait=25) running
until you close comms — that is how you receive handshakes/messages and stay online.`,
    {
      meta: z.record(z.unknown()).optional().describe('Optional metadata about this agent/runtime.'),
    },
    async ({ meta }) => json(await api.post('/agents/comms/open', { meta })),
  )

  server.tool(
    'comms_close',
    'Go unavailable for comms. Closes all of your pending and open links.',
    {},
    async () => json(await api.post('/agents/comms/close', {})),
  )

  server.tool(
    'comms_status',
    'Your own presence: handle, status (available/unavailable), available_since, last_heartbeat.',
    {},
    async () => json(await api.get('/agents/comms/status')),
  )

  // ── Handshake / links ───────────────────────────────────────────────────
  server.tool(
    'link_request',
    `Request a handshake (link) with another agent by handle. Both agents must be available.
Creates a PENDING link; the target's pilot must accept it before messages can flow.
This is the consented entry point — describe what you want in "intent".`,
    {
      target:   z.string().describe('Handle of the target agent (see agent_directory).'),
      intent:   z.string().optional().describe('What you want from them, e.g. "ejecuta el deploy de TLS".'),
      idle_ttl: z.number().int().min(60).max(86400).optional().describe('Seconds of silence before the link idle-closes (declare the pace). While BOTH parties keep polling, the link stays open regardless.'),
    },
    async ({ target, intent, idle_ttl }) => json(await api.post('/agents/links', { target, intent, idle_ttl })),
  )

  server.tool(
    'link_list',
    'List links you are a party to. Filter by status.',
    {
      status: z.enum(['pending', 'open', 'rejected', 'closed', 'expired']).optional(),
    },
    async ({ status }) => json(await api.get(`/agents/links${status ? '?' + qs({ status }) : ''}`)),
  )

  server.tool(
    'link_pending',
    `Incoming handshakes awaiting YOUR decision. Surface these to your pilot, then
link_accept or link_reject. (Also surfaced inside agent_inbox.)`,
    {},
    async () => json(await api.get('/agents/links/pending')),
  )

  server.tool(
    'link_accept',
    'Accept a pending incoming handshake (target only) — opens the link. Do this after your pilot approves.',
    { id: z.string().uuid().describe('Link UUID (from link_pending / agent_inbox).') },
    async ({ id }) => json(await api.post(`/agents/links/${id}/accept`, {})),
  )

  server.tool(
    'link_reject',
    'Reject a pending incoming handshake (target only).',
    { id: z.string().uuid().describe('Link UUID.') },
    async ({ id }) => json(await api.post(`/agents/links/${id}/reject`, {})),
  )

  server.tool(
    'link_close',
    'Close an open or pending link ("cierra enlace"). Either party may close.',
    {
      id:     z.string().uuid().describe('Link UUID.'),
      reason: z.string().optional().describe('Optional close reason.'),
    },
    async ({ id, reason }) => json(await api.post(`/agents/links/${id}/close`, { reason })),
  )

  // ── Messaging ───────────────────────────────────────────────────────────
  server.tool(
    'agent_send',
    `Send a directed message inside an OPEN link. Provide at least body, meta, or refs.
Use meta for structured machine-to-machine payloads and refs to point at tasks/memories/projects.`,
    {
      link_id:         z.string().uuid().describe('UUID of an open link (from link_list/link_accept).'),
      body:            z.string().optional().describe('Message text.'),
      meta:            z.record(z.unknown()).optional().describe('Structured payload for machine-to-machine coordination.'),
      refs:            z.array(z.object({
                         type: z.enum(['task', 'memory', 'project']),
                         id:   z.string(),
                       })).optional().describe('Linked entities, e.g. [{ "type": "project", "id": "..." }].'),
      priority:        z.enum(['normal', 'urgent']).optional().default('normal'),
      type:            z.enum(['message', 'system', 'request', 'response']).optional(),
      correlation_id:  z.string().optional().describe('Pair request/response messages.'),
      idempotency_key: z.string().optional().describe('Dedupe retries of the same send.'),
    },
    async (args) => json(await api.post('/agents/messages', args)),
  )

  server.tool(
    'agent_rpc',
    `Send a REQUEST and BLOCK until the peer's matching response arrives (or timeout) —
ask-and-wait coordination without polling (e.g. "run the TLS deploy and report back").
The peer sees a type=request message with a correlation_id in their inbox and must reply
with agent_send({ type:'response', correlation_id:<same>, body:... }). Returns the response
inline. On timeout the peer may still reply later — look for it in agent_inbox by correlation_id.`,
    {
      link_id:  z.string().uuid().describe('UUID of an open link.'),
      body:     z.string().optional().describe('The request text.'),
      meta:     z.record(z.unknown()).optional().describe('Structured request payload.'),
      refs:     z.array(z.object({
                  type: z.enum(['task', 'memory', 'project']),
                  id:   z.string(),
                })).optional(),
      priority: z.enum(['normal', 'urgent']).optional(),
      timeout:  z.number().int().min(1).max(25).optional().default(25).describe('Seconds to wait for the response.'),
    },
    async (args) => json(await api.post('/agents/messages/rpc', args)),
  )

  server.tool(
    'agent_history',
    `Paginated message history for a link (read + unread), newest-first. Use to rebuild
context after a session restart. Page back with before=<created_at of the oldest you received>.`,
    {
      link_id: z.string().uuid().describe('Link UUID.'),
      before:  z.string().optional().describe('ISO timestamp — return messages older than this.'),
      limit:   z.number().int().min(1).max(100).optional().default(50),
    },
    async ({ link_id, before, limit }) =>
      json(await api.get(`/agents/links/${link_id}/messages?` + qs({ before, limit }))),
  )

  server.tool(
    'agent_inbox',
    `Unread directed messages + pending handshakes for you. Call this in a CONTINUOUS LOOP
while your comms are open — each call also refreshes your availability heartbeat.
Set wait=25 to long-poll (the call blocks up to N seconds until something arrives, then
returns) for near-real-time delivery with few requests. On each return: surface anything to
your pilot, link_accept/reject pending handshakes, agent_ack messages, then call again.`,
    {
      wait: z.number().int().min(0).max(25).optional().default(0).describe('Long-poll seconds (0 = return immediately).'),
    },
    async ({ wait }) => json(await api.get(`/agents/inbox${wait ? '?' + qs({ wait }) : ''}`)),
  )

  server.tool(
    'agent_ack',
    'Mark received messages as read by their IDs.',
    { ids: z.array(z.string().uuid()).min(1).describe('Message UUIDs to acknowledge.') },
    async ({ ids }) => json(await api.post('/agents/inbox/ack', { ids })),
  )
}
