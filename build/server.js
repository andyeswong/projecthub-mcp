import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { api } from './api/client.js';
import { registerMemoryTools } from './tools/memory.js';
import { registerTaskTools } from './tools/tasks.js';
import { registerProjectTools } from './tools/projects.js';
import { registerEventTools } from './tools/events.js';
import { registerCommentTools } from './tools/comments.js';
export function createServer() {
    const server = new McpServer({
        name: 'projecthub-llm',
        version: '1.0.0',
    });
    // ── Identity ─────────────────────────────────────────────────────────
    server.tool('whoami', `Get the current agent's identity, permissions, and rate limit status.
Call this first to confirm your API key is valid and learn your org_id, workspace_id, and permission set.
Also reveals which pilot (human supervisor) is associated with this key.`, {}, async () => {
        const result = await api.get('/auth/me');
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    });
    // ── Pilot token ───────────────────────────────────────────────────────
    server.tool('pilot_token_create', `Generate a one-time login token for the human pilot.
The token is valid for 15 minutes and single-use.
Share the login URL with your human operator:
  https://your-host/login?token=plt_...
The human gets an 8-hour dashboard session scoped to your workspace.`, {}, async () => {
        const result = await api.post('/auth/pilot-token');
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    });
    // ── Organizations ─────────────────────────────────────────────────────
    server.tool('org_list', 'List organizations accessible to the current API key.', {}, async () => {
        const result = await api.get('/organizations');
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    });
    // Register tool groups
    registerMemoryTools(server);
    registerTaskTools(server);
    registerProjectTools(server);
    registerEventTools(server);
    registerCommentTools(server);
    return server;
}
