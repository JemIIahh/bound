import 'dotenv/config'
import { z } from 'zod'

const hex = z.string().regex(/^0x[0-9a-fA-F]+$/)
/** A whole number from env, where an empty value means "use the default". */
const intEnv = (def: number, min = 0) => z.preprocess((v) => (v === '' ? undefined : v), z.coerce.number().int().min(min).default(def))
const schema = z.object({
  TEMPO_NETWORK: z.enum(['testnet', 'mainnet']).default('testnet'),
  BOUND_REGISTRY_ADDRESS: hex,
  BOUND_REGISTRY_DEPLOY_BLOCK: z.coerce.bigint().default(0n),
  ATTESTER_PRIVATE_KEY: hex,
  SERVER_SECRET: hex.refine((s) => s.length === 66, 'SERVER_SECRET must be 32 bytes hex'),
  ANTHROPIC_API_KEY: z.string().default(''),
  // Optional Anthropic-compatible gateway for the agent (e.g. 0G Compute's router, https://router-api.0g.ai) and
  // the model id it serves; empty = Anthropic's API and the default model.
  ANTHROPIC_BASE_URL: z.string().optional().transform((v) => (v?.trim() ? v.trim().replace(/\/+$/, '') : undefined)),
  AGENT_MODEL: z.string().optional().transform((v) => (v?.trim() ? v.trim() : undefined)),
  DATABASE_PATH: z.string().default('./bound.db'),
  PORT: z.coerce.number().default(8787),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  DEMO_ROOT_PRIVATE_KEY: z.string().optional().transform((v) => (v ? (v as `0x${string}`) : undefined)),
  // When set, POST /v1/orgs/:orgId/authorize-demo only signs for this org (the seeded demo org).
  DEMO_ORG_ID: z.string().optional().transform((v) => (v?.trim() ? v.trim() : undefined)),
  // Attack lab (guard-off demo). Always on for testnet; on mainnet only when explicitly enabled.
  LAB_ENABLED: z.enum(['true', 'false', '']).optional().transform((v) => v === 'true'),
  // Public demo (/v1/demo, testnet only): the org it runs on, never the filmed DEMO_ORG_ID (demo:public-org
  // creates one); runs per client IP per hour, and runs per rolling day for everyone (0 pauses it).
  DEMO_PUBLIC_ORG_ID: z.string().optional().transform((v) => (v?.trim() ? v.trim() : undefined)),
  DEMO_RUNS_PER_IP_HOUR: intEnv(6, 1),
  DEMO_RUNS_PER_DAY: intEnv(300),
  // Early-access sign-ups (POST /v1/signups) per client IP per hour.
  SIGNUPS_PER_IP_HOUR: intEnv(10, 1),
})

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const e = schema.parse(env)
  return {
    network: e.TEMPO_NETWORK,
    registry: e.BOUND_REGISTRY_ADDRESS as `0x${string}`,
    registryDeployBlock: e.BOUND_REGISTRY_DEPLOY_BLOCK,
    attesterKey: e.ATTESTER_PRIVATE_KEY as `0x${string}`,
    serverSecret: e.SERVER_SECRET as `0x${string}`,
    anthropicKey: e.ANTHROPIC_API_KEY,
    anthropicBaseUrl: e.ANTHROPIC_BASE_URL,
    agentModel: e.AGENT_MODEL,
    databasePath: e.DATABASE_PATH,
    port: e.PORT,
    webOrigin: e.WEB_ORIGIN,
    demoRootKey: e.DEMO_ROOT_PRIVATE_KEY,
    demoOrgId: e.DEMO_ORG_ID,
    labEnabled: e.LAB_ENABLED,
    demoPublicOrgId: e.DEMO_PUBLIC_ORG_ID,
    demoRunsPerIpHour: e.DEMO_RUNS_PER_IP_HOUR,
    demoRunsPerDay: e.DEMO_RUNS_PER_DAY,
    signupsPerIpHour: e.SIGNUPS_PER_IP_HOUR,
  }
}
export type Config = ReturnType<typeof loadConfig>
