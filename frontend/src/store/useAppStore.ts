import { create } from 'zustand'
import { api } from '@/services'
import type { Permission, User } from '@/types'

interface AppState {
  currentUser: User | null
  authLoading: boolean
  serverError: string
  dark: boolean
  toast: string
  refresh: () => void
  login: (user: User) => void
  logout: () => void
  setDark: (value: boolean) => void
  notify: (message: string) => void
  can: (permission: Permission) => boolean
}

export const useAppStore = create<AppState>((set, get) => ({
  currentUser: null,
  authLoading: true,
  serverError: '',
  dark: localStorage.getItem('range-dark-mode') === 'true',
  toast: '',
  refresh: () => { window.dispatchEvent(new Event('rangeops:refresh')) },
  login: (user) => { set({ currentUser: user, authLoading: false, serverError: '' }); get().refresh() },
  logout: () => {
    set({ currentUser: null })
    void api.logout().catch(() => {})
  },
  setDark: (dark) => { localStorage.setItem('range-dark-mode', String(dark)); set({ dark }) },
  notify: (toast) => {
    set({ toast })
    window.setTimeout(() => set((state) => state.toast === toast ? { toast: '' } : {}), 3200)
  },
  can: (permission) => {
    const user = get().currentUser
    return !!user && (user.role === 'admin' || user.permissions.includes(permission))
  },
}))

if (typeof window !== 'undefined') {
  window.addEventListener('rangeops:unauthorized', () => useAppStore.setState({ currentUser: null }))
  window.addEventListener('rangeops:forbidden', (event) => {
    const message = (event as CustomEvent<string>).detail || 'You do not have permission to perform this action.'
    useAppStore.getState().notify(`No permission: ${message}`)
  })
}
