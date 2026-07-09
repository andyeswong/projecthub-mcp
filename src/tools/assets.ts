import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ApiClient } from '../api/client.js'

/**
 * Assets (F1) — an independent binary store for logos, screenshots, moodboards
 * and brand references. Assets stand alone (no brand required); Brands (F2)
 * reference them via brand_attach_asset. Bytes are passed as base64 (MCP is
 * JSON-only); the backend stores them on a disk and embeds the description for
 * semantic search.
 */
export function registerAssetTools(server: McpServer, api: ApiClient): void {
  server.tool(
    'asset_upload',
    `Upload a binary asset (logo, screenshot, moodboard, brand reference) to the org's asset store.
Pass the file as base64 in \`data\`. Give a rich \`description\` — it is embedded so you can find the asset later with asset_search. Assets need no brand; link one to a brand afterwards with brand_attach_asset. Max ~8MB per upload.`,
    {
      data:         z.string().describe('base64-encoded file bytes'),
      filename:     z.string().describe('Original filename, e.g. "logo-alti.png"'),
      mime_type:    z.string().optional().describe('e.g. "image/png"; sniffed from bytes if omitted'),
      kind:         z.enum(['logo', 'logo-mark', 'icon', 'screenshot', 'reference', 'moodboard', 'mockup', 'other'])
                      .default('reference')
                      .describe('What kind of asset this is'),
      description:  z.string().optional().describe('What this asset is / when to use it — embedded for search'),
      tags:         z.array(z.string()).optional(),
      brand_hint:   z.string().uuid().optional().describe('Optional brand id this asset probably belongs to (convenience only)'),
      workspace_id: z.string().uuid().optional().describe('Target workspace; defaults to the first in the org'),
    },
    async (body) => {
      const result = await api.post('/assets', body)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
    },
  )

  server.tool(
    'asset_list',
    'List assets in the org. Filter by kind, tags (comma-separated), or a keyword q on filename/description.',
    {
      kind:         z.string().optional().describe('Comma-separated kinds, e.g. "logo,screenshot"'),
      tags:         z.string().optional().describe('Comma-separated tags'),
      q:            z.string().optional().describe('Keyword on filename/description'),
      limit:        z.number().int().min(1).max(100).optional(),
      workspace_id: z.string().uuid().optional(),
    },
    async (args) => {
      const qs = new URLSearchParams()
      for (const [k, v] of Object.entries(args)) {
        if (v !== undefined && v !== null) qs.set(k, String(v))
      }
      const q = qs.toString()
      const result = await api.get(`/assets${q ? `?${q}` : ''}`)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
    },
  )

  server.tool(
    'asset_search',
    'Semantic search over asset descriptions — find a stored image by meaning, e.g. "dark editorial hero reference".',
    {
      q:            z.string().describe('What you are looking for'),
      limit:        z.number().int().min(1).max(100).optional(),
      workspace_id: z.string().uuid().optional(),
    },
    async (body) => {
      const result = await api.post('/assets/search', body)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
    },
  )

  server.tool(
    'asset_get',
    'Get one asset\'s metadata by id (includes raw_url to fetch the bytes).',
    {
      id: z.string().uuid(),
    },
    async ({ id }) => {
      const result = await api.get(`/assets/${id}`)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
    },
  )

  server.tool(
    'asset_extract_palette',
    `Read the brand palette out of an image asset's pixels — the dominant colors plus a proposed role for each (bg, text, accent, surface).
Deterministic quantization, no vision model, so the hexes are really in the image. They are bucket averages: snap them to the brand's exact values before saving. Fonts are NOT inferred — they cannot be read off pixels honestly.
Feed the result to brand_upsert as tokens.colors.`,
    { id: z.string().uuid().describe('Asset UUID (must be an image)') },
    async ({ id }) => {
      const result = await api.post(`/assets/${id}/palette`)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
    },
  )
}
