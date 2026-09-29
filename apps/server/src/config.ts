import 'dotenv/config'
import { z } from 'zod'

const hex = z.string().regex(/^0x[0-9a-fA-F]+$/)
const schema = z.object({
  TEMPO_NETWORK: z.enum(['testnet', 'mainnet']).default('testnet'),
  BOUND_REGISTRY_ADDRESS: hex,
  BOUND_REGISTRY_DEPLOY_BLOCK: z.coerce.bigint().default(0n),
  ATTESTER_PRIVATE_KEY: hex,
  SERVER_SECRET: hex.refine((s) => s.length === 66, 'SERVER_SECRET must be 32 bytes hex'),
  ANTHROPIC_API_KEY: z.string().default(''),
  DATABASE_PATH: z.string().default('./bound.db'),
  PORT: z.coerce.number().default(8787),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  DEMO_ROOT_PRIVATE_KEY: z.string().optional().transform((v) => (v ? (v as `0x${string}`) : undefined)),
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
    databasePath: e.DATABASE_PATH,
    port: e.PORT,
    webOrigin: e.WEB_ORIGIN,
    demoRootKey: e.DEMO_ROOT_PRIVATE_KEY,
  }
}
export type Config = ReturnType<typeof loadConfig>
