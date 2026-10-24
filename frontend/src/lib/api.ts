export interface ApiError extends Error {
  status: number
  code: string
  fields?: Record<string, string>
}

export function isServerUnavailable(error: unknown): error is ApiError {
  return error instanceof Error && 'code' in error && error.code === 'SERVER_UNAVAILABLE'
}

type RequestOptions = RequestInit & {
  query?: Record<string, string | number | boolean | undefined | null>
}

const SERVER_UNAVAILABLE_MESSAGE = 'Cannot reach the server. Check that the backend is running and try again.'

function clearAuthAndRedirect(): void {
  window.dispatchEvent(new Event('rangeops:unauthorized'))
  if (window.location.pathname !== '/login') window.location.assign('/login')
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { query, ...init } = options
  const url = new URL(path, window.location.origin)
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value))
  }
  const headers = new Headers(init.headers)
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  let response: Response
  try {
    response = await fetch(url, { ...init, headers, credentials: 'include' })
  } catch {
    const error = new Error(SERVER_UNAVAILABLE_MESSAGE) as ApiError
    error.status = 0
    error.code = 'SERVER_UNAVAILABLE'
    throw error
  }
  if (response.status === 401 && !path.endsWith('/auth/login')) clearAuthAndRedirect()
  if ([502, 503, 504].includes(response.status)) {
    const error = new Error(SERVER_UNAVAILABLE_MESSAGE) as ApiError
    error.status = response.status
    error.code = 'SERVER_UNAVAILABLE'
    throw error
  }
  if (!response.ok) {
    let payload: { error?: { code?: string; message?: string; fields?: Record<string, string> } } = {}
    try { payload = await response.json() } catch { /* Use the HTTP status for non-JSON errors. */ }
    const error = new Error(payload.error?.message ?? response.statusText ?? 'Request failed') as ApiError
    error.status = response.status
    error.code = payload.error?.code ?? `HTTP_${response.status}`
    error.fields = payload.error?.fields
    if (response.status === 403) window.dispatchEvent(new CustomEvent('rangeops:forbidden', { detail: error.message }))
    throw error
  }
  if (response.status === 204) return undefined as T
  const contentType = response.headers.get('content-type') ?? ''
  return (contentType.includes('application/json') ? response.json() : response.blob()) as Promise<T>
}

export async function downloadFile(path: string, filename: string): Promise<void> {
  const blob = await request<Blob>(path)
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  link.click()
  URL.revokeObjectURL(link.href)
}

export function uploadFile<T>(path: string, file: File, fieldName = 'file'): Promise<T> {
  const body = new FormData()
  body.append(fieldName, file)
  return request<T>(path, { method: 'POST', body })
}
