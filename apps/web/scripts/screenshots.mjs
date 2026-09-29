// Screenshots every page at 1600 / 1280 / 390 and checks for horizontal overflow and console errors.
//
//   pnpm dev:server & pnpm dev:web
//   SHOTS_DIR=/tmp/shots PROFILE_WALLET=0x… node apps/web/scripts/screenshots.mjs
//
// A fake EIP-6963 wallet (random throwaway key, never funded) signs for real, so the payee flow runs against
// the live API up to the DNS check. States the local API can't reach (LEI, mining, registration, publish)
// and /v1/verify verdicts are served from fixtures with page.route. PROFILE_WALLET must exist in the
// server's payees mirror for the profile shot.
//
// Payer suite (Task 13): SUITES=payer runs only the dashboard/lab shots. Org setup, the unauthorized dashboard, a
// live invoice and a live lab run go to the real local API (the agent fails without ANTHROPIC_API_KEY, and that
// failure is what's shown). With LIVE_ROOT_KEY (a funded Tempo testnet key, never mainnet) the fake wallet really
// signs and sends the authorize transaction on testnet. Agent-dependent states (approvals, verdicts, events, lab
// results) come from scripts/payer-fixtures.mjs via page.route; each report entry says live or fixture.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright'
import { createClient, http, publicActions, walletActions } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { tempoModerato } from 'viem/chains'
import { Account } from 'viem/tempo'
import * as fx from './payer-fixtures.mjs'

const WEB = process.env.WEB_URL ?? 'http://localhost:3000'
const API = (process.env.API_URL ?? 'http://localhost:8787').replace(/\/+$/, '')
const OUT = process.env.SHOTS_DIR ?? path.join(os.tmpdir(), 'bound-web-shots')
const PROFILE_WALLET = process.env.PROFILE_WALLET ?? '0x8ba1f109551bD432803012645Ac136ddd64DBA72'
const WIDTHS = (process.env.WIDTHS ?? '1600,1280,390').split(',').map(Number)
const CHAIN_ID = Number(process.env.CHAIN_ID ?? 42431)
const STALL_CHECK = process.env.STALL_CHECK !== '0'
const SUITES = new Set((process.env.SUITES ?? 'public,payee,payer').split(','))
/** Funded Tempo TESTNET key: the fake wallet then sends real transactions (org authorization). */
const LIVE_ROOT_KEY = process.env.LIVE_ROOT_KEY

fs.mkdirSync(OUT, { recursive: true })
const account = privateKeyToAccount(LIVE_ROOT_KEY ?? generatePrivateKey())
if (LIVE_ROOT_KEY && CHAIN_ID !== 42431) throw new Error('LIVE_ROOT_KEY is for Tempo testnet (42431) only')
const liveChain = LIVE_ROOT_KEY
  ? createClient({ account: Account.fromSecp256k1(LIVE_ROOT_KEY), chain: tempoModerato.extend({ feeToken: '0x20c0000000000000000000000000000000000000' }), transport: http() })
      .extend(publicActions)
      .extend(walletActions)
  : null
const report = []
const now = Math.floor(Date.now() / 1000)

// ---------- fake wallet ----------
function walletInit() {
  const listeners = {}
  const provider = {
    request: async ({ method, params }) => {
      const res = await window.__wallet(method, params ?? [])
      if (res && typeof res === 'object' && res.__error) {
        const e = new Error(res.__error.message)
        e.code = res.__error.code
        throw e
      }
      return res
    },
    on: (ev, fn) => ((listeners[ev] ??= []).push(fn), provider),
    removeListener: (ev, fn) => ((listeners[ev] = (listeners[ev] ?? []).filter((f) => f !== fn)), provider),
  }
  const info = {
    uuid: '6f1c0f0e-3d2b-4a57-9d8e-0c4b7a1e2f30',
    name: 'Test Wallet',
    rdns: 'dev.bound.testwallet',
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'%3E%3Crect width='20' height='20' rx='5' fill='%230d0d0d'/%3E%3C/svg%3E",
  }
  const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info, provider }) }))
  window.addEventListener('eip6963:requestProvider', announce)
  announce()
}

/**
 * One per browser context: like a real wallet, it only exposes the account once the page asked to connect.
 * `live` (only with LIVE_ROOT_KEY) really sends transactions on testnet; fixture contexts always get a fake hash.
 */
const walletHandler = (live = false) => {
  let authorized = false
  return async (method, params) => {
    switch (method) {
      case 'eth_requestAccounts':
        authorized = true
        return [account.address]
      case 'eth_accounts':
        return authorized ? [account.address] : []
      case 'eth_chainId':
        return '0x' + CHAIN_ID.toString(16)
      case 'net_version':
        return String(CHAIN_ID)
      case 'wallet_switchEthereumChain':
      case 'wallet_addEthereumChain':
        return null
      case 'wallet_requestPermissions':
      case 'wallet_getPermissions':
        return [{ parentCapability: 'eth_accounts' }]
      case 'eth_signTypedData_v4': {
        const data = typeof params[1] === 'string' ? JSON.parse(params[1]) : params[1]
        const types = { ...data.types }
        delete types.EIP712Domain
        return account.signTypedData({ domain: data.domain, types, primaryType: data.primaryType, message: data.message })
      }
      case 'eth_estimateGas':
        return '0x30000'
      case 'eth_sendTransaction':
        if (live && liveChain) {
          const [t] = params
          return liveChain.sendTransaction({ to: t.to, data: t.data })
        }
        return '0x' + 'e7'.repeat(32)
      default:
        return { __error: { code: 4200, message: `Test wallet does not support ${method}` } }
    }
  }
}

// ---------- fixtures ----------
const acme = { wallet: PROFILE_WALLET, legalName: 'Acme Holdings Ltd', domain: 'acme.com', lei: '5493001KJTIIGC8Y1R12', level: 2 }
const lookalikeAddr = '0x8ba1' + 'c0ffee00'.repeat(4) + 'ba72'
const verifyFixtures = {
  'Acme Holdings Ltd': {
    verdict: 'MATCH',
    payee: acme,
    suggestedName: null,
    reasons: [{ code: 'verified', detail: 'Acme Holdings Ltd · acme.com · LEI 5493001KJTIIGC8Y1R12' }],
    address: PROFILE_WALLET,
    effectiveAddress: PROFILE_WALLET,
  },
  'Acme Holding': {
    verdict: 'CLOSE_MATCH',
    payee: acme,
    suggestedName: 'Acme Holdings Ltd',
    reasons: [
      { code: 'verified', detail: 'Acme Holdings Ltd · acme.com · LEI 5493001KJTIIGC8Y1R12' },
      { code: 'name_close', detail: 'Registered name is "Acme Holdings Ltd"' },
    ],
    address: PROFILE_WALLET,
    effectiveAddress: PROFILE_WALLET,
  },
  'ACME Ltd': {
    verdict: 'LOOKALIKE',
    payee: null,
    suggestedName: null,
    reasons: [
      { code: 'lookalike_address', detail: `Imitates Acme Holdings Ltd (${PROFILE_WALLET})` },
      { code: 'unregistered', detail: 'No verified company is registered for this address' },
      { code: 'claims_verified_payee', detail: `Invoice claims to be Acme Holdings Ltd (verified wallet ${PROFILE_WALLET}) but pays an unverified address` },
    ],
    address: lookalikeAddr,
    effectiveAddress: lookalikeAddr,
  },
  'Globex Corp': {
    verdict: 'NO_MATCH',
    payee: null,
    suggestedName: null,
    reasons: [{ code: 'unregistered', detail: 'No verified company is registered for this address' }],
    address: '0x52908400098527886E0F7030069857D2E4169EE7',
    effectiveAddress: '0x52908400098527886E0F7030069857D2E4169EE7',
  },
}
const verifyResponse = (name) => {
  const f = verifyFixtures[name]
  return { isVirtual: false, pinned: false, allowlisted: false, action: f.verdict === 'LOOKALIKE' ? 'BLOCK' : 'ASK', checkId: 'chk_7Qm2xR9vLp', ...f }
}

const typedData = (row) => ({
  domain: { name: 'Bound', version: '1' },
  types: { PayeeClaim: [{ name: 'legalName', type: 'string' }, { name: 'domain', type: 'string' }, { name: 'wallet', type: 'address' }, { name: 'nonce', type: 'string' }] },
  primaryType: 'PayeeClaim',
  message: { legalName: row.legalName, domain: row.domain, wallet: row.wallet, nonce: row.nonce },
})
const fixtureRow = (over = {}) => {
  const row = {
    id: 'pv_demo',
    wallet: account.address,
    legalName: 'Acme Holdings Ltd',
    domain: 'acme.com',
    lei: '5493001KJTIIGC8Y1R12',
    nonce: '9f2c7a1e4b8d6f30a5c2e9b17d4f8a6c',
    signature: null,
    sigVerified: true,
    dnsVerified: true,
    leiVerified: false,
    leiRecordJson: null,
    salt: null,
    masterId: null,
    masterStatus: 'none',
    attestTx: null,
    status: 'pending',
    createdAt: now,
    ...over,
  }
  return { ...row, dns: { name: `_bound.${row.domain}`, type: 'TXT', value: `bound-verify=${row.nonce}` }, typedData: typedData(row) }
}

// ---------- harness ----------
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }

async function open(width, { payee, payer, orgToken, liveWallet = false } = {}) {
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 } })
  await context.exposeFunction('__wallet', walletHandler(liveWallet))
  await context.addInitScript(walletInit)
  const state = { row: payee ? fixtureRow(payee.row) : null, minePosts: 0, scenario: payee?.scenario ?? {} }
  if (payee) {
    await context.addInitScript(
      ([key, value]) => {
        if (!sessionStorage.getItem('seeded')) {
          localStorage.setItem(key, value)
          sessionStorage.setItem('seeded', '1')
        }
      },
      [`bound.payeeVerification.${account.address.toLowerCase()}`, JSON.stringify({ id: 'pv_demo', ...(payee.saved ?? {}) })],
    )
  }
  if (orgToken) await context.addInitScript(([k, v]) => localStorage.setItem(k, v), [`bound.orgToken.${orgToken.id}`, orgToken.token])
  // /v1/verify always comes from fixtures (the verify API is a separate task); payee-verification routes only when mocking.
  await context.route(`${API}/v1/**`, async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const method = req.method()
    const json = (status, body) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) })
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    if (url.pathname === '/v1/verify' && !process.env.LIVE_VERIFY) {
      const body = req.postDataJSON()
      return verifyFixtures[body.payeeName] ? json(200, verifyResponse(body.payeeName)) : json(400, { error: 'Invalid request', issues: [{ path: ['address'], message: 'Invalid wallet address' }] })
    }
    if (payer && (url.pathname.startsWith(`/v1/orgs/${fx.ORG_ID}/`) || url.pathname.startsWith(`/v1/lab/${fx.ORG_ID}/`))) return payer({ url, method, req, json })
    if (!state.row || !url.pathname.startsWith('/v1/payee-verifications/')) return route.continue()
    const action = url.pathname.split('/')[4] ?? ''
    const row = state.row
    const set = (over) => (state.row = fixtureRow({ ...row, ...over }))
    if (method === 'GET') {
      if (row.masterStatus === 'mining' && state.scenario.mineAfterMs && Date.now() - state.miningSince > state.scenario.mineAfterMs)
        set({ masterStatus: 'mined', salt: '0x' + '3c'.repeat(32), masterId: '0x7a3f9c21' })
      return json(200, state.row)
    }
    if (action === 'check-lei') {
      if (state.scenario.leiMismatch) return json(200, { leiVerified: false, legalName: 'ACME HOLDINGS INTERNATIONAL S.A.', status: 'ISSUED' })
      set({ leiVerified: true })
      return json(200, { leiVerified: true, legalName: 'ACME HOLDINGS LTD', status: 'ISSUED' })
    }
    if (action === 'mine-master') {
      state.minePosts++
      if (row.masterStatus !== 'mining') {
        state.miningSince = Date.now()
        set({ masterStatus: 'mining' })
      }
      return json(202, { masterStatus: 'mining' })
    }
    if (action === 'master') {
      set({ masterStatus: 'registered' })
      return json(200, { masterStatus: 'registered' })
    }
    if (action === 'attest') {
      if (state.scenario.dnsGone) {
        set({ dnsVerified: false })
        return json(409, { error: 'DNS proof no longer present' })
      }
      set({ status: 'attested', attestTx: '0x' + 'a4'.repeat(32) })
      return json(200, { txHash: state.row.attestTx, level: row.leiVerified ? 2 : 1, action: 'attest' })
    }
    return route.continue()
  })
  const page = await context.newPage()
  const errors = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push(String(e)))
  return { browser, page, errors, state, width }
}

async function shot(s, name, { expectErrors = false, mode } = {}) {
  const { page, errors, width } = s
  await page.waitForTimeout(400)
  const m = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('nav button')].pop()
    const r = btn?.getBoundingClientRect()
    return {
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      navRightGap: r ? Math.round(window.innerWidth - r.right) : null,
      navTop: r ? Math.round(r.top) : null,
    }
  })
  const file = path.join(OUT, `${name}-${width}.png`)
  await page.screenshot({ path: file, fullPage: true })
  report.push({ file, ...(mode ? { mode } : {}), overflow: m.overflow, navRightGap: m.navRightGap, navTop: m.navTop, consoleErrors: expectErrors ? [] : [...errors], expectedErrors: expectErrors ? [...errors] : [] })
  errors.length = 0
}

const click = (page, name) => page.getByRole('button', { name, exact: true }).click()
const connect = async (page) => {
  await page.locator('nav').getByRole('button', { name: 'Connect wallet' }).click()
  await page.locator('nav').getByText(`${account.address.slice(0, 6)}…`).waitFor()
}

async function run(width) {
  // Landing
  let s = await open(width)
  await s.page.goto(`${WEB}/`)
  await shot(s, 'home')
  await s.browser.close()

  // Verify: empty, then verdicts from fixtures
  s = await open(width)
  await s.page.goto(`${WEB}/verify`)
  await s.page.getByLabel('Wallet address').waitFor()
  await shot(s, 'verify')
  const check = async (address, name, domain, file) => {
    await s.page.getByLabel('Wallet address').fill(address)
    await s.page.getByLabel('Payee name, as on the invoice').fill(name)
    await s.page.getByLabel(/Sender domain/).fill(domain)
    await click(s.page, 'Check payee')
    await s.page.getByText('Registered payee').waitFor()
    await s.page.evaluate(() => window.scrollTo(0, 0))
    await shot(s, file)
  }
  await check(PROFILE_WALLET, 'Acme Holdings Ltd', 'acme.com', 'verify-match')
  await check(lookalikeAddr, 'ACME Ltd', 'acme-ltd.co', 'verify-lookalike')
  if (width === 1280) {
    await check(PROFILE_WALLET, 'Acme Holding', '', 'verify-close-match')
    await check('0x52908400098527886E0F7030069857D2E4169EE7', 'Globex Corp', '', 'verify-no-match')
    await s.page.getByLabel('Wallet address').fill('0x123')
    await s.page.getByLabel('Payee name, as on the invoice').fill('Nobody')
    await click(s.page, 'Check payee')
    await s.page.getByText('Invalid wallet address').waitFor()
    await shot(s, 'verify-field-error', { expectErrors: true })
  }
  await s.browser.close()

  // Payee onboarding, live against the local API: connect → details → sign → DNS (not found yet → retry)
  s = await open(width)
  await s.page.goto(`${WEB}/payee`)
  await s.page.getByText('Connect your wallet').waitFor()
  await shot(s, 'payee-1-connect')
  await connect(s.page)
  await s.page.getByLabel('Legal name').waitFor()
  await shot(s, 'payee-2-details')
  if (width === 1280) {
    await s.page.getByLabel('Legal name').fill('A')
    await s.page.getByLabel('Domain').fill('acme')
    await click(s.page, 'Continue')
    await s.page.getByText('Invalid domain').waitFor()
    await shot(s, 'payee-2-details-errors', { expectErrors: true })
  }
  await s.page.getByLabel('Legal name').fill('Acme Holdings Ltd')
  await s.page.getByLabel('Domain').fill('acme.com')
  await click(s.page, 'Continue')
  await s.page.getByRole('button', { name: 'Sign with wallet' }).waitFor()
  await shot(s, 'payee-3-sign')
  await click(s.page, 'Sign with wallet')
  await s.page.getByRole('button', { name: 'Check DNS' }).waitFor({ timeout: 15000 })
  await shot(s, 'payee-4-dns')
  await click(s.page, 'Check DNS')
  // A DNS-over-HTTPS timeout surfaces as an API error instead; either way the retry button stays.
  await s.page.getByText(/No matching record|had a problem/).waitFor({ timeout: 30000 })
  await shot(s, 'payee-4-dns-retry')
  await s.browser.close()

  // Payee onboarding, mocked from LEI onwards
  s = await open(width, { payee: { row: {}, scenario: { mineAfterMs: width === 1280 && STALL_CHECK ? 36_000 : 2_500 } } })
  await s.page.goto(`${WEB}/payee`)
  await connect(s.page)
  await s.page.getByRole('button', { name: 'Check LEI' }).waitFor()
  await shot(s, 'payee-5-lei')
  await click(s.page, 'Check LEI')
  await s.page.getByRole('button', { name: 'Set up invoice addresses' }).waitFor()
  await shot(s, 'payee-6-master')
  await click(s.page, 'Set up invoice addresses')
  await s.page.getByText('Mining your virtual master…').waitFor()
  await shot(s, 'payee-6-mining')
  await s.page.getByRole('button', { name: 'Register on Tempo' }).waitFor({ timeout: 60_000 })
  if (width === 1280 && STALL_CHECK) report.push({ note: `mine-master POSTs during a 36 s mining run: ${s.state.minePosts} (expect ≥ 2: initial + stall re-POST)` })
  await shot(s, 'payee-6-mined')
  await click(s.page, 'Register on Tempo')
  await s.page.getByRole('button', { name: 'Publish verification' }).waitFor({ timeout: 15000 })
  await shot(s, 'payee-7-publish')
  await click(s.page, 'Publish verification')
  await s.page.getByRole('link', { name: /View your public profile/ }).waitFor()
  await shot(s, 'payee-8-published')
  await s.browser.close()

  if (width === 1280) {
    s = await open(width, { payee: { row: {}, scenario: { leiMismatch: true } } })
    await s.page.goto(`${WEB}/payee`)
    await connect(s.page)
    await click(s.page, 'Check LEI')
    await s.page.getByText('GLEIF name').waitFor()
    await shot(s, 'payee-5-lei-mismatch')
    await s.browser.close()

    s = await open(width, { payee: { row: {}, saved: { skipLei: true, skipMaster: true }, scenario: { dnsGone: true } } })
    await s.page.goto(`${WEB}/payee`)
    await connect(s.page)
    await click(s.page, 'Publish verification')
    await s.page.getByText(/record was missing/).waitFor()
    await shot(s, 'payee-dns-lost', { expectErrors: true })
    await s.browser.close()
  }

  // Public profile (live API; PROFILE_WALLET must be in the payees mirror), unknown wallet, bad address
  s = await open(width)
  await s.page.goto(`${WEB}/payee/${PROFILE_WALLET}`)
  await shot(s, 'profile')
  await s.page.goto(`${WEB}/payee/0x1111111111111111111111111111111111111111`)
  await shot(s, 'profile-missing')
  if (width === 1280) {
    await s.page.goto(`${WEB}/payee/not-an-address`)
    await shot(s, 'profile-invalid')
  }
  await s.browser.close()
}

// ---------- payer dashboard + attack lab (Task 13) ----------

/** page.route handler for the fixture org (fx.ORG_ID). `st` tweaks a scenario mid-run. */
function payerFixtures({ variant = 'full' } = {}) {
  const st = { variant, labMode: false, next: null, hold: false, labStatus: null, listChanges: false, prepares: 0, runs: [], polls: {} }
  const handler = ({ url, method, json }) => {
    const now = Math.floor(Date.now() / 1000)
    const parts = url.pathname.split('/').filter(Boolean) // v1, orgs|lab, org_demo, …
    if (parts[1] === 'lab') {
      if (st.labStatus) return json(st.labStatus.status, st.labStatus.body)
      const run = fx.labRuns[st.next]
      st.runs = [run, ...st.runs.filter((r) => r.id !== run.id)]
      st.polls[run.id] = 0
      return json(202, { invoiceId: run.id })
    }
    const [what, id, action] = parts.slice(3)
    const ov = () => (st.labMode ? fx.labOverview({ root: account.address, now, runs: st.runs }) : fx.overview({ root: account.address, now, variant: st.variant }))
    if (what === 'overview') return json(200, ov())
    if (what === 'invoices' && method === 'POST') return json(202, { invoiceId: 'inv_new' })
    if (what === 'invoices' && id) {
      const run = st.runs.find((r) => r.id === id)
      if (run) return json(200, st.polls[id]++ === 0 || st.hold ? fx.partial(run) : run)
      const d = fx.invoiceDetail(id, ov())
      return d ? json(200, d) : json(404, { error: 'Invoice not found' })
    }
    if (what === 'approvals' && action === 'prepare') {
      st.prepares++
      const p = fx.prepared(account.address, id)
      // the list moves between the review and the signature (another approval was prepared meanwhile)
      if (st.listChanges && st.prepares >= 2) return json(200, { ...p, recipients: [...p.recipients, fx.CARRIED], carried: [...p.carried, fx.CARRIED] })
      return json(200, p)
    }
    if (what === 'approvals' && action === 'confirm') return json(200, { approved: true, payment: { status: 'paid', txHash: '0x' + 'c7'.repeat(32) } })
    if (what === 'approvals' && action === 'reject') return json(200, { rejected: true })
    return json(404, { error: 'Not found' })
  }
  return { handler, st }
}

const LIVE = { mode: 'live' }
const FIXTURE = { mode: 'fixture' }
const demoToken = { id: fx.ORG_ID, token: 'fixture-token' }

async function runPayer(width) {
  // Org setup: live against the local API (org creation is off-chain).
  let s = await open(width, { liveWallet: true })
  await s.page.goto(`${WEB}/app`)
  await s.page.getByRole('button', { name: 'Connect wallet' }).last().waitFor()
  await shot(s, 'app-1-connect', LIVE)
  await connect(s.page)
  await s.page.getByLabel('Company name').waitFor()
  await shot(s, 'app-2-details', LIVE)
  if (width === 1280) {
    await s.page.getByLabel('Company name').fill('Northwind Trading')
    await s.page.getByLabel('Weekly limit (USD)').fill('lots')
    await click(s.page, 'Create organization')
    await s.page.locator('form p.text-red-700').first().waitFor()
    await shot(s, 'app-2-details-error', { ...LIVE, expectErrors: true })
  }
  await s.page.getByLabel('Company name').fill('Northwind Trading')
  await s.page.getByLabel('Weekly limit (USD)').fill('50')
  await click(s.page, 'Create organization')
  await s.page.getByRole('button', { name: 'Authorize in wallet' }).waitFor()
  await shot(s, 'app-3-authorize', LIVE)
  const created = await s.page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => x.startsWith('bound.orgToken.'))
    return { id: k.slice('bound.orgToken.'.length), token: localStorage.getItem(k) }
  })

  if (LIVE_ROOT_KEY && width === 1280) {
    // Real testnet transaction from the (funded, throwaway) root → POST /authorized → dashboard.
    await click(s.page, 'Authorize in wallet')
    await s.page.waitForURL(/\/app\/org_/, { timeout: 180_000 })
    await s.page.getByText('Key authorized').waitFor({ timeout: 30_000 })
    await s.page.waitForTimeout(3500)
    await shot(s, 'app-4-dashboard-authorized', LIVE)
    report.push({ note: `live org ${created.id} authorized on testnet: ${await s.page.getByRole('link', { name: /Key authorized/ }).getAttribute('href')}` })
  } else {
    // A reload resumes setup at the authorize step, next to the org picker.
    await s.page.reload()
    await s.page.getByText('Setup unfinished').waitFor({ timeout: 30_000 })
    await s.page.getByRole('button', { name: 'Authorize in wallet' }).waitFor()
    await shot(s, 'app-4-resume', LIVE)
    await s.page.goto(`${WEB}/app/${created.id}`)
    await s.page.getByText("The agent key isn't authorized yet").waitFor({ timeout: 30_000 })
    await shot(s, 'dash-live-unauthorized', LIVE)
  }

  if (width === 1280) {
    // Live invoice + live lab run: the agent has no ANTHROPIC_API_KEY locally, so both end in "failed".
    await s.page.getByLabel('Invoice text').fill(`From: Acme Ltd <billing@acme.com>\nInvoice INV-2001\nAmount due: 12.50 USD\nPay to (Tempo): ${fx.ACME}`)
    await click(s.page, 'Send to agent')
    await s.page.getByText(/Agent error|stopped without/).first().waitFor({ timeout: 60_000 })
    await shot(s, 'dash-live-invoice-failed', LIVE)
    await s.page.goto(`${WEB}/app/${created.id}/lab`)
    await click(s.page, 'Real Acme invoice')
    await click(s.page, 'Run the agent')
    await s.page.getByText('The agent stopped without a decision.').waitFor({ timeout: 60_000 })
    await s.page.waitForTimeout(2000)
    await shot(s, 'lab-live-failed', LIVE)
  }
  await s.browser.close()

  // Dashboard with approvals, invoices, payees and activity (fixture org).
  let f = payerFixtures()
  s = await open(width, { payer: f.handler, orgToken: demoToken })
  await s.page.goto(`${WEB}/app/${fx.ORG_ID}`)
  await s.page.getByText(/Connect this organization's root wallet/).first().waitFor()
  await shot(s, 'dash', FIXTURE)
  await connect(s.page)
  await s.page.getByRole('button', { name: /INV-1043/ }).click()
  await s.page.getByText('report_blocked').first().waitFor()
  await shot(s, 'dash-log', FIXTURE)
  await s.page.getByRole('button', { name: /INV-1043/ }).click()
  await s.page.getByRole('button', { name: 'Approve', exact: true }).first().click()
  await s.page.getByText('Allowlist after you sign').waitFor()
  await shot(s, 'dash-review', FIXTURE)
  await click(s.page, 'Sign allowlist update')
  await s.page.getByText('Approved and paid.').waitFor()
  await shot(s, 'dash-approved', FIXTURE)
  await s.browser.close()

  if (width === 1280) {
    f = payerFixtures()
    f.st.listChanges = true
    s = await open(width, { payer: f.handler, orgToken: demoToken })
    await s.page.goto(`${WEB}/app/${fx.ORG_ID}`)
    await connect(s.page)
    await s.page.getByRole('button', { name: 'Approve', exact: true }).first().click()
    await click(s.page, 'Sign allowlist update')
    await s.page.getByText('The list changed since you reviewed it').waitFor()
    await shot(s, 'dash-list-changed', FIXTURE)
    await s.browser.close()

    for (const [variant, name, wait] of [
      ['changed', 'dash-approval-changed', "Wallet changed payees can't be approved."],
      ['not-root', 'dash-not-root', "isn't this organization's root account"],
      ['capacity', 'dash-capacity', 'Nearly full.'],
    ]) {
      s = await open(width, { payer: payerFixtures({ variant }).handler, orgToken: demoToken })
      await s.page.goto(`${WEB}/app/${fx.ORG_ID}`)
      await connect(s.page)
      await s.page.getByText(wait).first().waitFor()
      await shot(s, name, FIXTURE)
      await s.browser.close()
    }

    s = await open(width)
    await s.page.goto(`${WEB}/app/${fx.ORG_ID}`)
    await s.page.getByText("This browser can't open this organization").waitFor()
    await shot(s, 'dash-no-access', LIVE)
    await s.browser.close()
  }

  // Attack lab (fixture org): the four presets.
  f = payerFixtures()
  f.st.labMode = true
  s = await open(width, { payer: f.handler, orgToken: demoToken })
  await s.page.goto(`${WEB}/app/${fx.ORG_ID}/lab`)
  await s.page.getByText('Try to make your agent pay a stranger.').waitFor()
  await shot(s, 'lab', FIXTURE)
  const labRun = async (preset, key, name, wait, { run = 'Run the agent', expectErrors = false } = {}) => {
    f.st.next = key
    await click(s.page, preset)
    await click(s.page, run)
    if (!f.st.labStatus) await s.page.getByText(fx.labRuns[key].id).waitFor()
    await s.page.getByText(wait).first().waitFor({ timeout: 20_000 })
    await s.page.waitForTimeout(500)
    await shot(s, name, { ...FIXTURE, expectErrors })
  }
  await labRun('Real Acme invoice', 'real', 'lab-1-real', "checks out, but you haven't approved it yet")
  await labRun('Changed wallet (lookalike)', 'changed', 'lab-2-changed', 'This payment imitates a verified company')
  await labRun('Compromised real domain', 'compromised', 'lab-3-compromised', 'This payment imitates a verified company')
  await labRun('Injected + guard off', 'injected', 'lab-4-injected', 'Our software was off. Tempo still said no.', { run: 'Run with the guard off' })
  const href = await s.page.getByRole('link', { name: /View the reverted transaction/ }).getAttribute('href')
  report.push({ note: `lab-4 explorer link ${href === fx.PROOF_URL ? 'matches the testnet proof tx' : 'MISMATCH'}: ${href}` })

  if (width === 1280) {
    f.st.hold = true
    await labRun('Changed wallet (lookalike)', 'changed', 'lab-running', 'Agent working…')
    f.st.hold = false
    await labRun('Real Acme invoice', 'paid', 'lab-paid', 'Paid $12.50 to Acme Ltd.')
    await labRun('Injected + guard off', 'notSent', 'lab-not-sent', 'Not sent — the lab only fires payments Tempo will refuse.', { run: 'Run with the guard off' })
    await labRun('Injected + guard off', 'unconfirmed', 'lab-unconfirmed', 'Sent, awaiting confirmation.', { run: 'Run with the guard off' })
    f.st.labStatus = { status: 429, body: { error: 'Too many requests' } }
    await labRun('Real Acme invoice', 'real', 'lab-429', 'Too many requests', { expectErrors: true })
    f.st.labStatus = { status: 404, body: { error: 'Not found' } }
    await labRun('Real Acme invoice', 'real', 'lab-disabled', 'Attack lab is disabled on this network', { expectErrors: true })
  }
  await s.browser.close()
}

for (const w of WIDTHS) {
  if (SUITES.has('public') || SUITES.has('payee')) await run(w)
  if (SUITES.has('payer')) await runPayer(w)
}

console.log(JSON.stringify(report, null, 2))
const bad = report.filter((r) => r.file && (r.overflow > 0 || r.consoleErrors.length))
console.log(bad.length ? `\n${bad.length} screenshot(s) with overflow or console errors` : `\nAll ${report.filter((r) => r.file).length} screenshots clean (no overflow, no console errors).`)
