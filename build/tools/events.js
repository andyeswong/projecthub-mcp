import { z } from 'zod';
import { api } from '../api/client.js';
export function registerEventTools(server) {
    server.tool('events_poll', `Poll the immutable activity event log. Returns events in ascending chronological order.
Use the since parameter to get only new events (pass the last event's created_at on the next call).
This is the primary mechanism for agents to stay in sync — no webhooks needed.

Polling pattern:
  1. Call events_poll with since = your last known timestamp
  2. Process each event
  3. Store the last event's created_at
  4. Repeat after a delay

Event types: agent.registered, project.created, project.updated,
task.created, task.updated, task.status_changed, task.blocked,
task.commented, task.moved, task.archived, task.unarchived,
memory.stored, memory.updated, memory.deleted, pilot.login`, {
        since: z.string().optional().describe('ISO 8601 timestamp — only return events after this point. Omit to get recent events.'),
        project_id: z.string().uuid().optional().describe('Filter events to a specific project'),
    }, async (params) => {
        const qs = new URLSearchParams(Object.fromEntries(Object.entries(params)
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => [k, String(v)]))).toString();
        const result = await api.get(`/events${qs ? '?' + qs : ''}`);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    });
}
