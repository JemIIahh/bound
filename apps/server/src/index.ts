import { loadConfig } from './config'
import { createDb, migrate } from './db/client'
import { createChain } from './chain'
import { createApp, finalize } from './app'
import { startIndexer } from './indexer'
import { payeesRouter } from './routes/payees'
import { productionChainOps, type ServiceDeps } from './services/payments'
import { verifyRouter } from './routes/verify'
import { orgsRouter } from './routes/orgs'
import { invoicesRouter } from './routes/invoices'
import { mountLab } from './routes/lab'
import { mountDemo } from './routes/demo'
import { mountMcp } from './mcp'

const config = loadConfig()
const db = createDb(config.databasePath)
migrate(db)
const chain = createChain(config)
startIndexer({ db, pub: chain.pub as any, registry: config.registry, fromBlock: config.registryDeployBlock, onError: (e) => console.error('[indexer]', e) })
const base = { db, chain, config }
const deps: ServiceDeps = { ...base, ops: productionChainOps(base) }
const app = createApp(deps)
// Routers mount here, before finalize(app).
app.use('/v1', payeesRouter(base))
app.use('/v1', verifyRouter(deps))
app.use('/v1', orgsRouter(deps))
app.use('/v1', invoicesRouter(deps))
if (!mountLab(app, deps)) console.log('attack lab disabled (mainnet without LAB_ENABLED=true)')
if (!mountDemo(app, deps)) console.log('public demo disabled (testnet only)')
mountMcp(app, deps) // public, read-only: verify_payee + lookup_payee only
finalize(app).listen(config.port, () => console.log(`bound server on :${config.port} (${config.network})`))
