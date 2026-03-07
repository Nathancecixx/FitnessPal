import { useMutation } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useMemo, useState } from 'react'

import { ActionButton, EmptyState, LabelledInput, Panel } from '../../components/ui'
import { api } from '../../lib/api'
import { queryClient } from '../../lib/query-client'

export function SetupPasswordPage() {
  const navigate = useNavigate()
  const token = useMemo(() => new URLSearchParams(window.location.search).get('token') ?? '', [])
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const setupPassword = useMutation({
    mutationFn: () => api.setupPassword(token, password),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['session'] })
      navigate({ to: '/' })
    },
  })

  if (!token) {
    return <EmptyState title="Setup token missing" body="Open the full password setup link from the admin account, including the token in the URL." />
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-lg items-center">
      <Panel
        title="Set your password"
        subtitle="This link is issued by an admin account. Once you save a password, this browser session signs in as your new user."
        className="w-full"
      >
        <form className="grid gap-4" onSubmit={(event) => {
          event.preventDefault()
          if (password !== confirmPassword) {
            setupPassword.reset()
            return
          }
          setupPassword.mutate()
        }}
        >
          <LabelledInput label="New password" type="password" value={password} onChange={setPassword} placeholder="At least 12 characters" />
          <LabelledInput label="Confirm password" type="password" value={confirmPassword} onChange={setConfirmPassword} placeholder="Repeat password" />
          {password && confirmPassword && password !== confirmPassword ? (
            <div className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-900">Passwords do not match.</div>
          ) : null}
          {setupPassword.isError ? (
            <div className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-900">{setupPassword.error.message}</div>
          ) : null}
          {setupPassword.isSuccess ? (
            <div className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900">Password saved. Redirecting...</div>
          ) : null}
          <ActionButton type="submit" disabled={setupPassword.isPending || password.length < 12 || password !== confirmPassword}>
            Save password
          </ActionButton>
        </form>
      </Panel>
    </div>
  )
}
