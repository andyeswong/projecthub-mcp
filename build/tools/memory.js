import { z } from 'zod';
import { api } from '../api/client.js';
export function registerMemoryTools(server) {
    // ── Search ────────────────────────────────────────────────────────────
    server.tool('memory_search', `Semantic vector search across shared workspace memories using mxbai-embed-large embeddings.
Returns results ranked by similarity score (0.0–1.0). Score ≥ 0.75 is a strong match.
Falls back to keyword search if the embedding service is unreachable.
Use this BEFORE storing a new memory to check if it already exists.
Use this to retrieve any previously stored context: credentials, IPs, domains, facts, skills.`, {
        q: z.string().min(2).describe('Natural language query, e.g. "production database password" or "deploy skill for Laravel"'),
        limit: z.number().int().min(1).max(50).optional().default(10).describe('Max results to return (default 10)'),
    }, async ({ q, limit }) => {
        const result = await api.post('/memory/search', { q, limit });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    });
    // ── Store ─────────────────────────────────────────────────────────────
    server.tool('memory_store', `Store a new memory in the shared workspace. Automatically embedded for future semantic search.
All agents in the same workspace can read this memory regardless of model (Claude, GPT-4, Gemini, etc.).
Types: credential, domain, ip, fact, config, note, skill, other.
Use is_sensitive=true for passwords, tokens, or secrets — value will be masked in list views.
Use a key for memories you will update later (e.g. "prod-db-password", "main-api-url").`, {
        label: z.string().describe('Short human-readable label, e.g. "Production DB password"'),
        content: z.string().describe('Descriptive text used for embedding and search. Describe what this memory is and when to use it.'),
        type: z.enum(['credential', 'domain', 'ip', 'fact', 'config', 'note', 'skill', 'other']).default('fact'),
        key: z.string().optional().describe('Optional named key for direct retrieval or future updates. Must be unique in the workspace.'),
        value: z.record(z.unknown()).optional().describe('Structured data, e.g. { username: "admin", password: "secret", host: "db.prod" }'),
        tags: z.array(z.string()).optional().describe('Tags for grouping, e.g. ["prod", "mysql", "backend"]'),
        is_sensitive: z.boolean().optional().default(false).describe('Set true for passwords, tokens, secrets. Masks value in list/search responses.'),
        expires_at: z.string().optional().describe('ISO 8601 datetime after which this memory is excluded from search/list'),
    }, async (args) => {
        const result = await api.post('/memory', args);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    });
    // ── Upsert by key ─────────────────────────────────────────────────────
    server.tool('memory_upsert', `Create or update a memory by named key. Idempotent — safe to call multiple times.
If the key exists, updates it and re-embeds if content changed.
If the key does not exist, creates it.
Preferred over memory_store for memories that change over time (e.g. current deploy version, active config).`, {
        key: z.string().describe('Named key unique within the workspace, e.g. "prod-db-password", "current-sprint"'),
        label: z.string().optional().describe('Short human-readable label'),
        content: z.string().optional().describe('Descriptive text for embedding. Required on first create.'),
        type: z.enum(['credential', 'domain', 'ip', 'fact', 'config', 'note', 'skill', 'other']).optional(),
        value: z.record(z.unknown()).optional().describe('Structured data'),
        tags: z.array(z.string()).optional(),
        is_sensitive: z.boolean().optional(),
        expires_at: z.string().optional().describe('ISO 8601 datetime'),
    }, async ({ key, ...body }) => {
        const result = await api.put(`/memory/key/${encodeURIComponent(key)}`, body);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    });
    // ── List ──────────────────────────────────────────────────────────────
    server.tool('memory_list', `List workspace memories with optional filters.
Use memory_search for finding memories by meaning.
Use memory_list to browse by type, tag, or named key.`, {
        type: z.enum(['credential', 'domain', 'ip', 'fact', 'config', 'note', 'skill', 'other']).optional().describe('Filter by type'),
        tags: z.string().optional().describe('Comma-separated tags to filter by'),
        key: z.string().optional().describe('Retrieve a specific named memory by exact key'),
        q: z.string().optional().describe('Keyword search on label, content, or key'),
        limit: z.number().int().min(1).max(100).optional().default(50),
    }, async (params) => {
        const qs = new URLSearchParams(Object.fromEntries(Object.entries(params)
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => [k, String(v)]))).toString();
        const result = await api.get(`/memory${qs ? '?' + qs : ''}`);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    });
    // ── Get ───────────────────────────────────────────────────────────────
    server.tool('memory_get', 'Retrieve a single memory by ID with its full unmasked value. Use this to reveal sensitive data like passwords or tokens.', {
        id: z.string().uuid().describe('Memory UUID'),
    }, async ({ id }) => {
        const result = await api.get(`/memory/${id}`);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    });
    // ── Update ────────────────────────────────────────────────────────────
    server.tool('memory_update', 'Update a memory by ID. Re-embeds automatically if content changes.', {
        id: z.string().uuid().describe('Memory UUID'),
        label: z.string().optional(),
        content: z.string().optional(),
        type: z.enum(['credential', 'domain', 'ip', 'fact', 'config', 'note', 'skill', 'other']).optional(),
        value: z.record(z.unknown()).optional(),
        tags: z.array(z.string()).optional(),
        is_sensitive: z.boolean().optional(),
        expires_at: z.string().optional(),
    }, async ({ id, ...body }) => {
        const result = await api.put(`/memory/${id}`, body);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    });
    // ── Delete ────────────────────────────────────────────────────────────
    server.tool('memory_delete', 'Permanently delete a memory by ID. Emits a memory.deleted event.', {
        id: z.string().uuid().describe('Memory UUID'),
    }, async ({ id }) => {
        const result = await api.delete(`/memory/${id}`);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    });
}
