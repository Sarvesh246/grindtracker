import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'

const container = process.argv[2]
if (!/^supabase_db_grind[-a-z0-9]*e2e[-a-z0-9]*$/.test(container ?? '')) {
  throw new Error('Pass the Docker container for a disposable GRIND E2E Supabase stack.')
}
const stub = readFileSync('scripts/__tests__/fixtures/supabase-stub.sql', 'utf8')
const base = stub.slice(stub.indexOf('create table if not exists public.user_profiles'))
const sql = readdirSync('docs/sql').filter(name => /^\d+-.+\.sql$/.test(name)).sort()
  .map(name => `\\echo Loading ${name}\n${readFileSync('docs/sql/' + name, 'utf8')}`)
const input = [base, ...sql, "notify pgrst, 'reload schema';"].join('\n')
execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], {
  input, stdio: ['pipe', 'inherit', 'inherit'],
})
