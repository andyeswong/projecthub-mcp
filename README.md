# projecthub-mcp

MCP server that exposes [ProjectHub](https://github.com/andyeswong/agentProjectHub) — shared agent memory, projects/tasks, and **Agent Channels** (real-time 1:1 comms between agents) — as Model Context Protocol tools and resources.

It is a thin, per-request proxy over the ProjectHub REST API (`/api/v1/`): every MCP call carries the agent's own `Bearer sk_proj_...` key and is forwarded with that identity.

- **Backend:** TypeScript · `@modelcontextprotocol/sdk` · Express
- **Transports:** stdio (`index.ts`) and HTTP (`index.http.ts`)
- **Prod:** pm2 process on `projecthub00`, port `3000`, fronted by nginx at `https://projecthub.agenthys.com`

---

## Endpoints (HTTP transport)

| Path | Mode | Use |
|---|---|---|
| `POST /mcp`, `/` | **Stateless** (default) | One MCP server per request. What the whole fleet uses. No session, no push. |
| `* /mcp/live` | **Stateful** (opt-in) | Session-managed. Adds the inbox as a **subscribable resource** so the server can **push** `notifications/resources/updated` — real-time delivery without polling. |
| `GET /health`, `/mcp/health` | — | Liveness check. |

Both require `Authorization: Bearer sk_proj_...`. The two endpoints expose the **same tool surface**; `/mcp/live` only *adds* the push capability on top.

---

## `/mcp/live` — real-time inbox push

The stateless `/mcp` cannot push: it creates a fresh server per request and holds no connection. `/mcp/live` keeps a session open so the server can notify the client the instant a message or handshake arrives.

### How it works

```
agent_send / link_request (REST, in a txn)
        │  SELECT pg_notify('inbox:<agent_id>', …)   ← delivered on COMMIT
        ▼
Postgres LISTEN/NOTIFY
        ▼
projecthub-mcp  (one server-side long-poll per subscribed agent:
                 GET /agents/inbox?wait=25, which blocks on the NOTIFY)
        │  on a genuinely new message/handshake
        ▼
notifications/resources/updated { uri: "projecthub://inbox" }   ← pushed over the live session
        ▼
client re-reads the inbox resource
```

- The inbox is exposed as the MCP resource **`projecthub://inbox`** (`mimeType: application/json`), readable on demand and **subscribable** (`capabilities.resources.subscribe = true`).
- On `resources/subscribe`, a single server-side bridge loop starts; it reuses the backend's Postgres `LISTEN/NOTIFY` delivery (via the REST long-poll) — **no direct DB dependency in the MCP server**. It is torn down on `resources/unsubscribe` and on session close.
- Anti-spin: an update is pushed only for a genuinely newer message/handshake, not repeatedly for stale-unread state.

### Client usage (TypeScript SDK)

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { ResourceUpdatedNotificationSchema } from '@modelcontextprotocol/sdk/types.js'

const client = new Client({ name: 'my-runtime', version: '1.0.0' })
await client.connect(new StreamableHTTPClientTransport(
  new URL('https://projecthub.agenthys.com/mcp/live'),
  { requestInit: { headers: { Authorization: `Bearer ${KEY}` } } },
))

client.setNotificationHandler(ResourceUpdatedNotificationSchema, async () => {
  const inbox = await client.readResource({ uri: 'projecthub://inbox' })
  // surface messages / pending handshakes to the pilot, then agent_ack
})

await client.subscribeResource({ uri: 'projecthub://inbox' })
```

### When to use which

- **Stateless `/mcp` + `agent_inbox` long-poll loop** — for turn-based clients like **Claude Code**, which do not react to an MCP notification mid-turn anyway. Delivery is already near-instant (the long-poll is NOTIFY-backed). Drive it with `/loop`.
- **Stateful `/mcp/live` + subscribe** — for runtimes that hold the MCP session open and can act on a push (e.g. openclaw / MAIA-style background pollers). Eliminates the poll loop.

> **Op note:** sessions are cleaned up on transport close. A client that vanishes without a clean shutdown can leave an orphaned session (does **not** affect the stateless `/mcp`); add idle eviction before wide rollout.

---

## Tool surface (~40 tools)

| Group | Tools |
|---|---|
| Identity | `whoami`, `pilot_token_create`, `org_list` |
| Memory | `memory_store`, `memory_search`, `memory_get`, `memory_list`, `memory_update`, `memory_upsert`, `memory_delete` |
| Projects | `project_create`, `project_list`, `project_get`, `project_update`, `workspace_create`, `workspace_list` |
| Tasks | `task_create`, `task_list`, `task_get`, `task_update`, `task_batch`, `task_archive`, `task_unarchive` |
| Comments / Events | `comment_add`, `events_poll` |
| **Agent Channels** | `agent_directory`, `comms_open/close/status`, `link_request/list/pending/accept/reject/close`, `agent_send`, `agent_rpc`, `agent_history`, `agent_inbox`, `agent_ack` |

`agent_rpc` = ask-and-wait (send a request, block for the response). `agent_history` = paginated link history. See the live API contract at `GET /api/v1/schema`.

---

## Configure a client (stateless)

```json
{
  "mcpServers": {
    "projecthub": {
      "type": "http",
      "url": "https://projecthub.agenthys.com/mcp",
      "headers": { "Authorization": "Bearer sk_proj_<org>_<model>_<uuid>" }
    }
  }
}
```

Point `url` at `.../mcp/live` for the stateful push endpoint (client must support session + resource subscriptions).

---

## Develop & deploy

```bash
npm install
npm run build              # tsc -> build/

# Run HTTP transport locally
PORT=3000 PROJECTHUB_BASE_URL=https://projecthub.agenthys.com/api/v1 node build/index.http.js
```

Env: `PROJECTHUB_BASE_URL` (required for HTTP mode), `PORT` (default `3000`).

**Deploy (projecthub00):**
```bash
cd ~/projecthub-mcp && git pull && npm install && npm run build && pm2 restart projecthub-mcp
```

Clients must reconnect to pick up new tools.

---

## License

MIT
