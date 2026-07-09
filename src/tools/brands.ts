import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ApiClient } from '../api/client.js'

/**
 * Brands (F2) — the visual identity a project wears. brand_resolve is to a
 * project what personality_resolve is to a body: ask which brand applies and
 * get the merged tokens, rules and asset pointers instead of guessing.
 *
 * Brands REFERENCE assets (F1) through brand_attach_asset; they never own them.
 */
export function registerBrandTools(server: McpServer, api: ApiClient): void {
  server.tool(
    'brand_resolve',
    `WEAR THE BRAND — resolve the visual identity that applies here, deep-merged across its inheritance chain.
Pass project_id (the project's brand, else its workspace default), or a slug to resolve one by name. Returns \`tokens\` (colors/fonts/radii — apply as CSS variables), \`rules\` (do/don't, obey them), and \`assets\` grouped by role (logo, hero-ref, moodboard…) as POINTERS — fetch raw_url only when you need the bytes.`,
    {
      slug:         z.string().optional().describe('Resolve this brand by name, e.g. "alti"'),
      project_id:   z.string().uuid().optional().describe('Resolve the brand this project follows'),
      workspace_id: z.string().uuid().optional().describe('Resolve this workspace\'s default brand'),
    },
    async (body) => {
      const result = await api.post('/brands/resolve', body)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
    },
  )

  server.tool(
    'brand_upsert',
    `Author/update a brand kit (idempotent per slug within a workspace).
Set \`parent_slug\` to inherit from another brand: tokens and voice deep-merge (your keys win), rules union. Mark \`is_default\` to make it the workspace fallback.`,
    {
      slug:         z.string().describe('Brand slug, e.g. "alti"'),
      name:         z.string().optional().describe('Display name, e.g. "ALTI"'),
      parent_slug:  z.string().optional().describe('Inherit from this brand (same workspace)'),
      tokens:       z.record(z.unknown()).optional().describe('{colors:{...}, fonts:{...}, radii:{...}, layout:{...}}'),
      voice:        z.record(z.unknown()).optional().describe('Tone of voice'),
      rules:        z.array(z.string()).optional().describe('Do/don\'t, e.g. "Never use gradients on the accent"'),
      meta:         z.record(z.unknown()).optional(),
      is_default:   z.boolean().optional().describe('Make this the workspace fallback brand'),
      status:       z.enum(['draft', 'active']).optional(),
      workspace_id: z.string().uuid().optional(),
    },
    async (body) => {
      const result = await api.post('/brands', body)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
    },
  )

  server.tool(
    'brand_list',
    'List the brands in this org.',
    {},
    async () => {
      const result = await api.get('/brands')
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
    },
  )

  server.tool(
    'brand_get',
    'Get one brand\'s RAW record by slug (unmerged, with its linked assets). Use brand_resolve for the effective, merged identity.',
    { slug: z.string() },
    async ({ slug }) => {
      const result = await api.get(`/brands/${encodeURIComponent(slug)}`)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
    },
  )

  server.tool(
    'brand_attach_asset',
    'Link an existing asset to a brand in a given role, so it shows on the brand board and comes back from brand_resolve. The asset keeps living on its own — this only creates a link.',
    {
      brand_id:   z.string().uuid().describe('Brand UUID (from brand_list/brand_get)'),
      asset_id:   z.string().uuid().describe('Asset UUID (from asset_upload/asset_search)'),
      role:       z.enum(['logo', 'logo-mark', 'icon', 'hero-ref', 'moodboard', 'mockup', 'palette-ref'])
                    .describe('Where the brand board paints it'),
      is_primary: z.boolean().optional(),
      sort_order: z.number().int().min(0).optional(),
    },
    async ({ brand_id, ...body }) => {
      const result = await api.post(`/brands/${brand_id}/assets`, body)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
    },
  )

  server.tool(
    'brand_detach_asset',
    'Unlink an asset from a brand. The asset itself is NOT deleted — only the link.',
    { brand_id: z.string().uuid(), asset_id: z.string().uuid() },
    async ({ brand_id, asset_id }) => {
      const result = await api.delete(`/brands/${brand_id}/assets/${asset_id}`)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
    },
  )
}
