import type { ReactNode } from 'react'
import { useAppStore } from '@/store/useAppStore'
import type { Permission } from '@/types'

export function Can({ permission, children }: { permission: Permission; children: ReactNode }) {
  return useAppStore((state) => state.can(permission)) ? <>{children}</> : null
}
