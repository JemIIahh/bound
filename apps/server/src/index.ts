import { loadConfig } from './config'
import { createDb, migrate } from './db/client'
import { createChain } from './chain'
import { createApp, finalize } from './app'
import { startIndexer } from './indexer'

const config = loadConfig()
const db = createDb(config.databasePath)
migrate(db)
const chain = createChain(config)
startIndexer({ db, pub: chain.pub as any, registry: config.registry, fromBlock: config.registryDeployBlock, onError: (e) => console.error('[indexer]', e) })
const app = createApp({ db, chain, config })
// Later tasks mount routers here, before finalize(app).
finalize(app).listen(config.port, () => console.log(`bound server on :${config.port} (${config.network})`))
