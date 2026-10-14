import { create } from 'zustand'
import { api } from '@/services/api'
import type { Database, Permission, User } from '@/types'

interface AppState extends Database {
  currentUser: User | null
  dark: boolean
  toast: string
  refresh: () => void
  login: (user: User) => void
  logout: () => void
  setDark: (value: boolean) => void
  notify: (message: string) => void
  can: (permission: Permission) => boolean
}

const initial = api.snapshot()
export const useAppStore = create<AppState>((set, get) => ({
  ...initial,
  currentUser: null,
  dark: localStorage.getItem('range-dark-mode') === 'true',
  toast: '',
  refresh: () => set(api.snapshot()),
  login: (user) => set({ currentUser: user }),
  logout: () => set({ currentUser: null }),
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

if (typeof window !== 'undefined') api.subscribe((data) => useAppStore.setState(data))
