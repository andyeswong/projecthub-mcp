const BASE_URL = (process.env.PROJECTHUB_BASE_URL ?? '').replace(/\/$/, '');
const TOKEN = process.env.PROJECTHUB_TOKEN ?? '';
if (!BASE_URL)
    throw new Error('PROJECTHUB_BASE_URL env var is required');
if (!TOKEN)
    throw new Error('PROJECTHUB_TOKEN env var is required');
async function request(method, path, body) {
    const url = `${BASE_URL}${path}`;
    const res = await fetch(url, {
        method,
        headers: {
            'Authorization': `Bearer ${TOKEN}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({ error: res.statusText }));
    if (!res.ok) {
        const msg = json?.error ?? json?.message ?? res.statusText;
        throw new Error(`ProjectHub API ${res.status}: ${msg}`);
    }
    return json;
}
export const api = {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    patch: (path, body) => request('PATCH', path, body),
    put: (path, body) => request('PUT', path, body),
    delete: (path) => request('DELETE', path),
};
