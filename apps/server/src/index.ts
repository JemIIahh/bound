import { loadConfig } from './config'
import { createDb, migrate } from './db/client'
import { createChain } from './chain'
import { createApp, finalize } from './app'
import { startIndexer } from './indexer'
import { payeesRouter } from './routes/payees'
import { productionChainOps, type ServiceDeps } from './services/payments'
import { verifyRouter } from './routes/verify'
import { orgsRouter } from './routes/orgs'

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
finalize(app).listen(config.port, () => console.log(`bound server on :${config.port} (${config.network})`))
