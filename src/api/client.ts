const BASE_URL = (process.env.PROJECTHUB_BASE_URL ?? '').replace(/\/$/, '')
const TOKEN    = process.env.PROJECTHUB_TOKEN ?? ''

if (!BASE_URL) throw new Error('PROJECTHUB_BASE_URL env var is required')
if (!TOKEN)    throw new Error('PROJECTHUB_TOKEN env var is required')

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const url = `${BASE_URL}${path}`

  const res = await fetch(url, {
    method,
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
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

export const api = {
  get:    <T>(path: string)                  => request<T>('GET',    path),
  post:   <T>(path: string, body?: unknown)  => request<T>('POST',   path, body),
  patch:  <T>(path: string, body?: unknown)  => request<T>('PATCH',  path, body),
  put:    <T>(path: string, body?: unknown)  => request<T>('PUT',    path, body),
  delete: <T>(path: string)                  => request<T>('DELETE', path),
}
