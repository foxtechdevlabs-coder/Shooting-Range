import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/services'
import { useAppStore } from '@/store/useAppStore'
import { isServerUnavailable } from '@/lib/api'
import type { AppSettings, Participant, Transaction, User, ActivityLog } from '@/types'

interface RangeData {
  participants: Participant[]
  transactions: Transaction[]
  users: User[]
  activity: ActivityLog[]
  settings: AppSettings
  loading: boolean
  participantError: string
  reload: () => Promise<void>
}

const defaultSettings: AppSettings = {
  eventName: 'Range Operations',
  logoText: 'RO',
  labelSize: 'medium',
  scanSound: true,
  duplicateWindowSeconds: 5,
}

export function useRangeData(participantQuery?: Record<string, string | number | undefined>): RangeData & { participantTotal: number } {
  const { currentUser, can, notify } = useAppStore()
  const [participants, setParticipants] = useState<Participant[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [activity, setActivity] = useState<ActivityLog[]>([])
  const [settings, setSettings] = useState<AppSettings>(defaultSettings)
  const [loading, setLoading] = useState(true)
  const hasLoaded = useRef(false)
  const latestRequest = useRef(0)
  const [participantTotal, setParticipantTotal] = useState(0)
  const [participantError, setParticipantError] = useState('')
  const participantQueryKey = JSON.stringify(participantQuery ?? { limit: 50 })
  const participantQueryMode = participantQuery !== undefined

  const reload = useCallback(async () => {
    if (!currentUser) return
    const requestId = ++latestRequest.current
    if (!hasLoaded.current) setLoading(true)
    const jobs = await Promise.allSettled([
      can('participants.view') ? api.listParticipants(JSON.parse(participantQueryKey) as Record<string, string | number | undefined>) : Promise.resolve({ data: [], total: 0, page: 0, limit: 50 }),
      participantQueryMode ? Promise.resolve({ data: [], total: 0, page: 0, limit: 20 }) : can('transactions.view') ? api.listTransactions({ limit: 20 }) : Promise.resolve({ data: [], total: 0, page: 0, limit: 20 }),
      participantQueryMode ? Promise.resolve([]) : can('users.manage') ? api.listUsers() : Promise.resolve([]),
      api.getSettings(),
      participantQueryMode ? Promise.resolve({ data: [], total: 0, page: 0, limit: 0 }) : can('users.manage') ? api.activity() : Promise.resolve({ data: [], total: 0, page: 0, limit: 0 }),
    ])
    if (requestId !== latestRequest.current) return
    const [participantResult, transactionResult, usersResult, settingsResult, activityResult] = jobs
    if (participantResult.status === 'fulfilled') {
      setParticipants(participantResult.value.data)
      setParticipantTotal(participantResult.value.total)
      setParticipantError('')
    } else {
      const error = participantResult.reason
      setParticipantError(error instanceof Error ? error.message : 'Could not load participants.')
    }
    if (transactionResult.status === 'fulfilled') setTransactions(transactionResult.value.data)
    if (usersResult.status === 'fulfilled') setUsers(usersResult.value)
    if (settingsResult.status === 'fulfilled') setSettings(settingsResult.value)
    if (activityResult.status === 'fulfilled') {
      const recorded = activityResult.value.data
      const generated = transactionResult.status === 'fulfilled'
        ? transactionResult.value.data.slice(0, 20).map((transaction) => ({
            id: transaction.id,
            userId: transaction.performedBy,
            action: transaction.type === 'check-in' ? 'Checked in' : 'Checked out',
            entity: 'Participant',
            details: `Bib ${transaction.participantBib ?? '—'} · ${transaction.participantName ?? transaction.gunNumber ?? ''}`,
            timestamp: transaction.timestamp,
          }))
        : []
      setActivity(recorded.length ? recorded : generated)
    }
    const failure = jobs.find((result) => result.status === 'rejected')
    if (failure?.status === 'rejected') {
      const error = failure.reason
      const message = error instanceof Error ? error.message : 'Could not load range data.'
      useAppStore.setState({ serverError: message })
      if (isServerUnavailable(error)) {
        setParticipants([])
        setTransactions([])
        setUsers([])
        setActivity([])
        setSettings(defaultSettings)
        setParticipantTotal(0)
      }
      notify(message)
    } else {
      useAppStore.setState({ serverError: '' })
    }
    setLoading(false)
    hasLoaded.current = true
  }, [currentUser, can, notify, participantQueryKey, participantQueryMode])

  useEffect(() => {
    void reload()
    window.addEventListener('rangeops:refresh', reload)
    return () => window.removeEventListener('rangeops:refresh', reload)
  }, [reload])

  return { participants, transactions, users, activity, settings, loading, reload, participantTotal, participantError }
}
