// Prints the early-access sign-up count, in total and per role. Never prints an email.
//   pnpm --filter @bound/server signups:count        (reads DATABASE_PATH from the shell or apps/server/.env)
import { resolve } from 'node:path'
import Database from 'better-sqlite3'
import { config as loadDotenv } from 'dotenv'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from '../src/db/schema'
import { signupCounts, SIGNUP_ROLES } from '../src/services/signups'

loadDotenv({ path: resolve(import.meta.dirname, '../.env') }) // shell variables win
const path = process.env.DATABASE_PATH || './bound.db'

let sqlite: Database.Database
try {
  sqlite = new Database(path, { readonly: true, fileMustExist: true })
} catch {
  console.error(`No database at ${path} (set DATABASE_PATH).`)
  process.exit(1)
}
const hasTable = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'signups'").get()
const { total, byRole } = hasTable ? signupCounts(drizzle(sqlite, { schema })) : { total: 0, byRole: Object.fromEntries(SIGNUP_ROLES.map((r) => [r, 0])) }
sqlite.close()

console.log(`Sign-ups: ${total}`)
for (const role of SIGNUP_ROLES) console.log(`  ${role.padEnd(9)}${byRole[role]}`)
