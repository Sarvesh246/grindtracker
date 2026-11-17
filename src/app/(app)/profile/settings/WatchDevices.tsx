'use client'
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { useToast } from '@/lib/contexts/ToastContext'
import { reportError } from '@/lib/utils/reportError'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import ConfirmDialog from '@/components/ui/ConfirmDialog'

/**
 * Settings → Watch: pair a Garmin watch with a per-device API token
 * (docs/watch-api.md). The token is minted by `create_watch_device` and shown
 * exactly once — only its hash is stored, so it can't be shown again.
 */

interface WatchDevice {
  id: string
  name: string
  token_hint: string
  created_at: string
  last_used_at: string | null
}

const titleStyle: CSSProperties = {
  fontSize: '14px',
  color: 'var(--text-primary)',
  fontWeight: 600,
  marginBottom: '2px',
}

const hintStyle: CSSProperties = {
  fontSize: '12px',
  color: 'var(--text-muted)',
}

const dividerStyle: CSSProperties = {
  height: '1px',
  backgroundColor: 'var(--border)',
}

/** "just now" / "5 min ago" / "3 h ago" / a local date. Runs client-side only
 *  (rows load in an effect), so the viewer's own timezone is used. */
function lastUsedLabel(iso: string | null): string {
  if (!iso) return 'Never used'
  const minutes = Math.floor((Date.now() - Date.parse(iso)) / 60_000)
  if (minutes < 1) return 'Last used just now'
  if (minutes < 60) return `Last used ${minutes} min ago`
  if (minutes < 24 * 60) return `Last used ${Math.floor(minutes / 60)} h ago`
  return `Last used ${new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
}

export default function WatchDevices({ supabase }: { supabase: SupabaseClient }) {
  const toast = useToast()
  const [devices, setDevices] = useState<WatchDevice[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [pairing, setPairing] = useState(false)
  const pairButtonRef = useRef<HTMLButtonElement>(null)
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [newToken, setNewToken] = useState<{ name: string; token: string } | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<WatchDevice | null>(null)
  const [revoking, setRevoking] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('watch_devices')
      .select('id, name, token_hint, created_at, last_used_at')
      .is('revoked_at', null)
      .order('created_at', { ascending: false })
    if (error) {
      // Most likely migration 58 isn't applied yet; don't pretend "no devices".
      setLoadFailed(true)
      return
    }
    setLoadFailed(false)
    setDevices((data ?? []) as WatchDevice[])
  }, [supabase])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async load, state set after await
    void load()
  }, [load])
  // Tokens made in "Sleep & health sources" must show up here without a reload.
  useEffect(() => {
    const again = () => void load()
    window.addEventListener('grind:watch-devices-changed', again)
    return () => window.removeEventListener('grind:watch-devices-changed', again)
  }, [load])

  async function handleCreate() {
    const deviceName = name.trim() || 'Garmin watch'
    setCreating(true)
    const { data, error } = await supabase.rpc('create_watch_device', { p_name: deviceName })
    setCreating(false)
    const created = data as { token?: string; name?: string } | null
    if (error || !created?.token) {
      const limit = error?.message?.includes('WATCH_DEVICE_LIMIT')
      if (error) reportError(error, { operation: 'create_watch_device' })
      toast.show(limit ? 'Revoke a watch first (10 max)' : "Couldn't create a token", 'error')
      return
    }
    setPairing(false)
    setNewToken({ name: created.name ?? deviceName, token: created.token })
    setName('')
    void load()
  }

  async function copyToken() {
    if (!newToken) return
    try {
      await navigator.clipboard.writeText(newToken.token)
      toast.show('Token copied')
    } catch {
      toast.show('Copy failed — select the token and copy it', 'error')
    }
  }

  async function confirmRevoke() {
    if (!revokeTarget) return
    setRevoking(true)
    const { error } = await supabase.rpc('revoke_watch_device', { p_id: revokeTarget.id })
    setRevoking(false)
    if (error) {
      reportError(error, { operation: 'revoke_watch_device' })
      toast.show("Couldn't revoke the watch", 'error')
      return
    }
    setRevokeTarget(null)
    toast.show('Watch revoked')
    void load()
    window.dispatchEvent(new CustomEvent('grind:watch-devices-changed', { detail: 'revoked' }))
  }

  return (
    <>
      <div className="settings-device-status">
        <div>
          <div style={titleStyle}>Garmin watches</div>
          <div style={hintStyle}>
            {loadFailed ? 'Could not load your watches.'
              : !devices ? 'Loading watches…'
                : devices.length === 0 ? 'No watches paired yet.'
                  : `${devices.length} paired ${devices.length === 1 ? 'watch' : 'watches'}`}
          </div>
        </div>
        {!newToken && (
          <Button
            ref={pairButtonRef}
            type="button"
            size="sm"
            variant={pairing ? 'secondary' : 'primary'}
            aria-expanded={pairing}
            disabled={!devices || loadFailed || creating}
            haptic="light"
            onClick={() => setPairing(!pairing)}
          >
            Pair a watch
          </Button>
        )}
      </div>

      {newToken ? (
        <div style={{
          display: 'flex', flexDirection: 'column', gap: '10px',
          padding: '12px', borderRadius: 'var(--radius-md)',
          backgroundColor: 'var(--surface-elevated)', border: '1px solid var(--accent)',
        }}>
          <div style={{ ...titleStyle, marginBottom: 0 }}>Token for {newToken.name}</div>
          <div style={hintStyle}>
            Copy it into the GRIND watch app now. It won&apos;t be shown again.
          </div>
          <code
            aria-label="Watch token"
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '12px',
              color: 'var(--text-primary)',
              wordBreak: 'break-all',
              userSelect: 'all',
              lineHeight: 1.5,
            }}
          >
            {newToken.token}
          </code>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button size="sm" onClick={copyToken} haptic="light">Copy token</Button>
            <Button size="sm" variant="secondary" onClick={() => setNewToken(null)}>Done</Button>
          </div>
        </div>
      ) : pairing && (
        <form
          className="settings-pair-form"
          onSubmit={e => {
            e.preventDefault()
            if (!creating) void handleCreate()
          }}
        >
          <label className="settings-pair-name">
            <span style={titleStyle}>Watch name</span>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Garmin watch" maxLength={40} />
          </label>
          <p style={hintStyle}>Generate a one-time token to enter in the GRIND app on your watch.</p>
          <div className="settings-pair-actions">
            <Button type="submit" size="sm" disabled={creating || loadFailed} haptic="medium">
              {creating ? 'Creating…' : 'Generate token'}
            </Button>
            <Button type="button" size="sm" variant="secondary" disabled={creating} haptic="light" onClick={() => {
              setPairing(false)
              pairButtonRef.current?.focus({ preventScroll: true })
            }}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {!loadFailed && devices && (
        devices.map(device => (
          <div key={device.id}>
            <div style={dividerStyle} />
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              gap: '12px', marginTop: '14px',
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ ...titleStyle, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {device.name}
                </div>
                <div style={hintStyle}>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>…{device.token_hint}</span>
                  {' · '}
                  {lastUsedLabel(device.last_used_at)}
                </div>
              </div>
              <Button size="sm" variant="danger" onClick={() => setRevokeTarget(device)} style={{ flexShrink: 0 }}>
                Revoke
              </Button>
            </div>
          </div>
        ))
      )}

      <ConfirmDialog
        open={revokeTarget !== null}
        title={`Revoke ${revokeTarget?.name ?? 'watch'}?`}
        message="It stops syncing right away. Workouts already synced stay in GRIND."
        confirmLabel="Revoke"
        busy={revoking}
        onConfirm={confirmRevoke}
        onCancel={() => setRevokeTarget(null)}
      />
    </>
  )
}
