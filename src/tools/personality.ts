import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { type ApiClient } from '../api/client.js'

export function registerPersonalityTools(server: McpServer, api: ApiClient) {

  // ── Resolve (WEAR) ────────────────────────────────────────────────────────
  server.tool(
    'personality_resolve',
    `WEAR YOUR SELF — resolve the personality this body should adopt. A personality
is a cascade: core (the invariant self) -> runtime (per client_type) -> channel
(per channel). The server reads YOUR client_type from the calling api key, so by
default you get the variant meant for your kind of body. Returns the assembled
identity: { soul, register, rules[], tools[], scopes[], model_pref }.

Use at session start: inject \`soul\` + \`rules\` as your system context, adopt the
\`register\`, and AUTO-LOAD each scope in \`scopes\` via memory_consolidate/search.
The body holds no identity state — fetch it here each session. Same MAIA, but the
Claude-Code body and the WhatsApp body wear different registers of one self.`,
    {
      slug:        z.string().optional().describe('Which self to wear, e.g. "maia". Omit to use this api key\'s bound personality.'),
      channel:     z.string().optional().describe('The channel you are speaking on (e.g. "whatsapp-dm", "telegram") to pull the channel layer. Omit for runtime-only.'),
      client_type: z.string().optional().describe('Override the body to resolve for (defaults to YOUR client_type). Use to preview another body\'s view.'),
      workspace_id: z.string().uuid().optional(),
    },
    async (body) => {
      const result = await api.post('/personalities/resolve', body)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
    },
  )

  // ── Get (raw tree) ────────────────────────────────────────────────────────
  server.tool(
    'personality_get',
    `Get the RAW cascade tree of a personality — every layer (core/runtime/channel)
unmerged, for inspection or editing. To actually WEAR the self, use
personality_resolve (which merges the layers for your body).`,
    {
      slug:         z.string().describe('Personality slug, e.g. "maia"'),
      workspace_id: z.string().uuid().optional(),
    },
    async ({ slug, ...qs }) => {
      const q = new URLSearchParams(
        Object.fromEntries(Object.entries(qs).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]))
      ).toString()
      const result = await api.get(`/personalities/${encodeURIComponent(slug)}${q ? '?' + q : ''}`)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
    },
  )

  // ── Upsert (author a layer) ───────────────────────────────────────────────
  server.tool(
    'personality_upsert',
    `Author/update ONE layer of a personality cascade (idempotent per slug + level
+ client_type + channel). Build a self bottom-up: first the \`core\` (the invariant
who-I-am: soul, values, language rules), then a \`runtime\` layer per body
(client_type = claude-code | openclaw | ...), then optionally \`channel\` layers.

Merge semantics at resolve time: scalars (register, model_pref) — deepest wins;
lists (rules, tools, scopes) — UNION; soul — core + addenda concatenated. So a
runtime/channel layer should hold only the DELTA from the core, not repeat it.`,
    {
      slug:              z.string().describe('Self slug, e.g. "maia"'),
      level:             z.enum(['core', 'runtime', 'channel']).describe('Depth: core (the self) | runtime (per body) | channel (per channel)'),
      name:              z.string().optional().describe('Display name (set on core), e.g. "MAIA"'),
      match_client_type: z.string().optional().describe('Required for runtime/channel: which body, e.g. "claude-code", "openclaw"'),
      match_channel:     z.string().optional().describe('Required for channel: which channel, e.g. "whatsapp-dm", "telegram"'),
      soul:              z.string().optional().describe('core: the full who-I-am. runtime/channel: an ADDENDUM (delta only).'),
      register:          z.string().optional().describe('Tone/voice register for this layer, e.g. "terse, dev, caveman-ok" or "warm, concise, chat"'),
      model_pref:        z.string().optional().describe('Preferred model HINT (the brain is swappable; not enforced)'),
      scopes:            z.array(z.string()).optional().describe('Memory scopes/topics to auto-load when wearing this layer'),
      tools:             z.array(z.string()).optional().describe('Tool/capability affordances for this body'),
      rules:             z.array(z.string()).optional().describe('Behavioral rules (unioned across layers)'),
      refs:              z.array(z.object({
        kind: z.enum(['memory', 'skill', 'tool', 'scope']).describe('What the pointer points at'),
        ref:  z.string().describe('The id / key / name of the artifact (e.g. a memory uuid, a skill key, a tool name)'),
        when: z.string().optional().describe('Trigger hint — when to fetch this, e.g. "building UI"'),
        load: z.enum(['eager', 'lazy']).optional().describe('eager = inject at wear; lazy = keep only the pointer, fetch on demand (default lazy)'),
        note: z.string().optional().describe('Human label for the pointer'),
      })).optional().describe('Lazy reference index — pointers to memories/skills/tools so the body fetches heavy context ON DEMAND instead of always loading it. Keeps context clean.'),
      meta:              z.record(z.any()).optional().describe('Escape hatch for runtime-specific knobs'),
      status:            z.enum(['draft', 'active']).optional(),
      workspace_id:      z.string().uuid().optional(),
    },
    async (body) => {
      const result = await api.post('/personalities', body)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
    },
  )
}
