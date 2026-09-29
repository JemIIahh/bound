// Deploys BoundRegistry(attester) to Tempo TESTNET (Moderato, chain 42431) from DEPLOYER_PRIVATE_KEY and
// records BOUND_REGISTRY_ADDRESS + BOUND_REGISTRY_DEPLOY_BLOCK in apps/server/.env.
// Prereq: `forge build` in contracts/. Refuses to redeploy over a live registry unless --redeploy.
// Usage: TEMPO_NETWORK=testnet tsx scripts/deploy-registry.ts [--redeploy]
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient, getAddress, http, publicActions, walletActions, type Hex } from 'viem'
import { privateKeyToAddress } from 'viem/accounts'
import { Account } from 'viem/tempo'
import { addressUrl, boundRegistryAbi, txUrl } from '@bound/core'
import { assertTestnetChain, die, ensureFunded, needKey, requireTestnet, SERVER_DIR, SERVER_ENV, setEnv } from './lib'

const { net, pub } = requireTestnet()
await assertTestnetChain(pub)

const existing = process.env.BOUND_REGISTRY_ADDRESS
if (existing && !/^0x0{40}$/.test(existing) && !process.argv.includes('--redeploy')) {
  const code = await pub.getCode({ address: getAddress(existing) }).catch(() => undefined)
  if (code && code !== '0x') {
    console.log(`BoundRegistry already deployed at ${existing} (block ${process.env.BOUND_REGISTRY_DEPLOY_BLOCK}); pass --redeploy to replace it.`)
    console.log(addressUrl('testnet', getAddress(existing)))
    process.exit(0)
  }
}

const artifactPath = resolve(SERVER_DIR, '../../contracts/out/BoundRegistry.sol/BoundRegistry.json')
let artifact: { abi: unknown[]; bytecode: { object: Hex } }
try { artifact = JSON.parse(readFileSync(artifactPath, 'utf8')) } catch { die(`missing ${artifactPath}: run \`forge build\` in contracts/ first`) }

const deployer = Account.fromSecp256k1(needKey('DEPLOYER_PRIVATE_KEY'))
const attester = privateKeyToAddress(needKey('ATTESTER_PRIVATE_KEY'))
console.log(`deployer ${deployer.address}\nattester ${attester}`)
await ensureFunded(pub, deployer.address, 'deployer')
await ensureFunded(pub, attester, 'attester') // it pays the fees of every attest() later

const client = createClient({ account: deployer, chain: net.chain, transport: http(net.rpc) }).extend(publicActions).extend(walletActions)
await assertTestnetChain(client)
const hash = await client.deployContract({ abi: artifact.abi as any, bytecode: artifact.bytecode.object, args: [attester] } as any)
console.log(`deploy tx ${txUrl('testnet', hash)}`)
const rc = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 })
if (rc.status !== 'success' || !rc.contractAddress) die(`deployment failed (${rc.status})`)
const address = getAddress(rc.contractAddress)
const onchainAttester = await pub.readContract({ address, abi: boundRegistryAbi, functionName: 'attester' })
if (getAddress(onchainAttester) !== getAddress(attester)) die(`attester mismatch: ${onchainAttester}`)

setEnv(SERVER_ENV, { BOUND_REGISTRY_ADDRESS: address, BOUND_REGISTRY_DEPLOY_BLOCK: rc.blockNumber.toString(), BOUND_REGISTRY_DEPLOY_TX: hash })
console.log(`BOUND_REGISTRY_ADDRESS=${address}`)
console.log(`BOUND_REGISTRY_DEPLOY_BLOCK=${rc.blockNumber}`)
console.log(`explorer: ${addressUrl('testnet', address)}`)
