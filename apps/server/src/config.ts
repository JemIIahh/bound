import 'dotenv/config'
import { concat, getAddress, isAddress, keccak256, stringToHex, type Address } from 'viem'
import { z } from 'zod'

const hex = z.string().regex(/^0x[0-9a-fA-F]+$/)
/** A whole number from env, where an empty value means "use the default". */
const intEnv = (def: number, min = 0) => z.preprocess((v) => (v === '' ? undefined : v), z.coerce.number().int().min(min).default(def))
/** A non-negative number from env (decimals allowed), where an empty value means "use the default". */
const numEnv = (def: number) => z.preprocess((v) => (v === '' ? undefined : v), z.coerce.number().min(0).default(def))
/** An optional 0x address from env, where an empty value means unset. */
const addressEnv = z.string().optional().transform((v) => (v?.trim() ? v.trim() : undefined))
  .refine((v) => v === undefined || isAddress(v), 'must be a 0x address')
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
  // Public paid-API demo (/v1/demo/api-runs, testnet only): runs per rolling day for everyone (0 pauses it); the per-IP
  // limit is DEMO_RUNS_PER_IP_HOUR. Its honest wallet (Acme) and hijack wallet (the lab lookalike) default on testnet to
  // the public demo deployment in the README.
  DEMO_API_RUNS_PER_DAY: intEnv(200),
  DEMO_PAYEE_ADDRESS: addressEnv,
  LAB_LOOKALIKE_ADDRESS: addressEnv,
  // HMAC key binding the demo paid API's 402 challenges (at least 32 bytes); unset, it is derived from SERVER_SECRET.
  MPP_SECRET_KEY: z.string().optional().transform((v) => (v?.trim() ? v.trim() : undefined))
    .refine((v) => v === undefined || new TextEncoder().encode(v).byteLength >= 32, 'MPP_SECRET_KEY must be at least 32 bytes'),
  // Agent spend caps. Every agent run is one invoice; runs per rolling day for everyone (dashboard, lab and public demo)
  // and per org (the public demo org is held by DEMO_RUNS_PER_DAY instead); 0 pauses new runs.
  AGENT_RUNS_PER_DAY: intEnv(500),
  AGENT_RUNS_PER_ORG_DAY: intEnv(50),
  // Model price for the usage log's cost estimate, USD per million tokens (defaults: Claude Opus 5 via 0G).
  AGENT_PRICE_IN_PER_MTOK: numEnv(5),
  AGENT_PRICE_OUT_PER_MTOK: numEnv(25),
  // Early-access sign-ups (POST /v1/signups) per client IP per hour.
  SIGNUPS_PER_IP_HOUR: intEnv(10, 1),
})

/** The public testnet demo deployment (README): Acme Ltd's verified wallet and the lab lookalike. Public addresses, not keys. */
export const TESTNET_DEMO_PAYEE: Address = '0xc1a53DA961B7A3A62db84Ae889f57fa818d3C426'
export const TESTNET_LAB_LOOKALIKE: Address = '0xC1A5d69D86Dea5CA36F7aE391b6610CfFB96C426'

/** A stable 32-byte MPP challenge key derived from SERVER_SECRET, so a fresh deploy needs no new setting. */
export const deriveMppSecret = (serverSecret: `0x${string}`) => keccak256(concat([stringToHex('bound/mpp-secret-key/v1'), serverSecret]))

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const e = schema.parse(env)
  const testnet = e.TEMPO_NETWORK === 'testnet'
  return {
    network: e.TEMPO_NETWORK,
    registry: e.BOUND_REGISTRY_ADDRESS as `0x${string}`,
    registryDeployBlock: e.BOUND_REGISTRY_DEPLOY_BLOCK,
    attesterKey: e.ATTESTER_PRIVATE_KEY as `0x${string}`,
    serverSecret: e.SERVER_SECRET as `0x${string}`,
    anthropicKey: e.ANTHROPIC_API_KEY,
    anthropicBaseUrl: e.ANTHROPIC_BASE_URL,
    agentModel: e.AGENT_MODEL,
    agentRunsPerDay: e.AGENT_RUNS_PER_DAY,
    agentRunsPerOrgDay: e.AGENT_RUNS_PER_ORG_DAY,
    agentPriceInPerMTok: e.AGENT_PRICE_IN_PER_MTOK,
    agentPriceOutPerMTok: e.AGENT_PRICE_OUT_PER_MTOK,
    databasePath: e.DATABASE_PATH,
    port: e.PORT,
    webOrigin: e.WEB_ORIGIN,
    demoRootKey: e.DEMO_ROOT_PRIVATE_KEY,
    demoOrgId: e.DEMO_ORG_ID,
    labEnabled: e.LAB_ENABLED,
    demoPublicOrgId: e.DEMO_PUBLIC_ORG_ID,
    demoRunsPerIpHour: e.DEMO_RUNS_PER_IP_HOUR,
    demoRunsPerDay: e.DEMO_RUNS_PER_DAY,
    demoApiRunsPerDay: e.DEMO_API_RUNS_PER_DAY,
    demoPayeeAddress: e.DEMO_PAYEE_ADDRESS ? getAddress(e.DEMO_PAYEE_ADDRESS) : testnet ? TESTNET_DEMO_PAYEE : undefined,
    labLookalikeAddress: e.LAB_LOOKALIKE_ADDRESS ? getAddress(e.LAB_LOOKALIKE_ADDRESS) : testnet ? TESTNET_LAB_LOOKALIKE : undefined,
    mppSecretKey: e.MPP_SECRET_KEY ?? deriveMppSecret(e.SERVER_SECRET as `0x${string}`),
    signupsPerIpHour: e.SIGNUPS_PER_IP_HOUR,
  }
}
export type Config = ReturnType<typeof loadConfig>
