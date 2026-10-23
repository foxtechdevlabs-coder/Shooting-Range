export function formatDateTime(value: string): string {
  return new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}

export function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
