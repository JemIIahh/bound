import { loadConfig } from './config'
import { createDb, migrate } from './db/client'
import { createChain } from './chain'
import { createApp, finalize } from './app'
import { startIndexer } from './indexer'
import { payeesRouter } from './routes/payees'

const config = loadConfig()
const db = createDb(config.databasePath)
migrate(db)
const chain = createChain(config)
startIndexer({ db, pub: chain.pub as any, registry: config.registry, fromBlock: config.registryDeployBlock, onError: (e) => console.error('[indexer]', e) })
const deps = { db, chain, config }
const app = createApp(deps)
// Routers mount here, before finalize(app).
app.use('/v1', payeesRouter(deps))
finalize(app).listen(config.port, () => console.log(`bound server on :${config.port} (${config.network})`))
