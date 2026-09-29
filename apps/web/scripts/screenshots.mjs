// Screenshots every page at 1600 / 1280 / 390 and checks for horizontal overflow and console errors.
//
//   pnpm dev:server & pnpm dev:web
//   SHOTS_DIR=/tmp/shots PROFILE_WALLET=0x… node apps/web/scripts/screenshots.mjs
//
// A fake EIP-6963 wallet (random throwaway key, never funded) signs for real, so the payee flow runs against
// the live API up to the DNS check. States the local API can't reach (LEI, mining, registration, publish)
// and /v1/verify verdicts are served from fixtures with page.route. PROFILE_WALLET must exist in the
// server's payees mirror for the profile shot.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

const WEB = process.env.WEB_URL ?? 'http://localhost:3000'
const API = (process.env.API_URL ?? 'http://localhost:8787').replace(/\/+$/, '')
const OUT = process.env.SHOTS_DIR ?? path.join(os.tmpdir(), 'bound-web-shots')
const PROFILE_WALLET = process.env.PROFILE_WALLET ?? '0x8ba1f109551bD432803012645Ac136ddd64DBA72'
const WIDTHS = (process.env.WIDTHS ?? '1600,1280,390').split(',').map(Number)
const CHAIN_ID = Number(process.env.CHAIN_ID ?? 42431)
const STALL_CHECK = process.env.STALL_CHECK !== '0'

fs.mkdirSync(OUT, { recursive: true })
const account = privateKeyToAccount(generatePrivateKey())
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

/** One per browser context: like a real wallet, it only exposes the account once the page asked to connect. */
const walletHandler = () => {
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

async function open(width, { payee } = {}) {
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 } })
  await context.exposeFunction('__wallet', walletHandler())
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

async function shot(s, name, { expectErrors = false } = {}) {
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
  report.push({ file, overflow: m.overflow, navRightGap: m.navRightGap, navTop: m.navTop, consoleErrors: expectErrors ? [] : [...errors], expectedErrors: expectErrors ? [...errors] : [] })
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

for (const w of WIDTHS) await run(w)

console.log(JSON.stringify(report, null, 2))
const bad = report.filter((r) => r.file && (r.overflow > 0 || r.consoleErrors.length))
console.log(bad.length ? `\n${bad.length} screenshot(s) with overflow or console errors` : `\nAll ${report.filter((r) => r.file).length} screenshots clean (no overflow, no console errors).`)
