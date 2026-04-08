export type ApiClient = {
  get:    <T>(path: string)                 => Promise<T>
  post:   <T>(path: string, body?: unknown) => Promise<T>
  patch:  <T>(path: string, body?: unknown) => Promise<T>
  put:    <T>(path: string, body?: unknown) => Promise<T>
  delete: <T>(path: string)                 => Promise<T>
}

export function createApiClient(token: string, baseUrl: string): ApiClient {
  const base = baseUrl.replace(/\/$/, '')

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type':  'application/json',
        'Accept':        'application/json',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })

    const json = await res.json().catch(() => ({ error: res.statusText }))

    if (!res.ok) {
      const msg = (json as any)?.error ?? (json as any)?.message ?? res.statusText
      throw new Error(`ProjectHub API ${res.status}: ${msg}`)
    }

    return json as T
  }

  return {
    get:    (path)        => request('GET',    path),
    post:   (path, body)  => request('POST',   path, body),
    patch:  (path, body)  => request('PATCH',  path, body),
    put:    (path, body)  => request('PUT',    path, body),
    delete: (path)        => request('DELETE', path),
  }
}

// Default client from env vars — used by stdio entry point
const BASE_URL = (process.env.PROJECTHUB_BASE_URL ?? '').replace(/\/$/, '')
const TOKEN    = process.env.PROJECTHUB_TOKEN ?? ''

function envClient(): ApiClient {
  if (!BASE_URL) throw new Error('PROJECTHUB_BASE_URL env var is required')
  if (!TOKEN)    throw new Error('PROJECTHUB_TOKEN env var is required')
  return createApiClient(TOKEN, BASE_URL)
}

export const api: ApiClient = {
  get:    (path)       => envClient().get(path),
  post:   (path, body) => envClient().post(path, body),
  patch:  (path, body) => envClient().patch(path, body),
  put:    (path, body) => envClient().put(path, body),
  delete: (path)       => envClient().delete(path),
}
