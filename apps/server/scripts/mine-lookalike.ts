// Mines the attack lab's lookalike wallet: a secp256k1 key whose address shares the first N and last N
// hex characters with the demo payee's wallet (N = 4 by default, the check Bound's core runs).
// Runs one worker thread per core; prints progress; gives up on N=4 after --minutes (default 60) and
// falls back to N=3, recording LOOKALIKE_CHARS=3 in apps/server/.env.
// Usage: TEMPO_NETWORK=testnet tsx scripts/mine-lookalike.ts [--chars 4] [--minutes 60]
//
// Speed: instead of one scalar multiplication per candidate, each worker walks M points in parallel
// (P_j += M·G per step, i.e. consecutive private keys) with one batched field inversion per step, and
// hashes with a generated, fully unrolled keccak-f[1600]. A found key is re-derived with viem before use.
import { availableParallelism } from 'node:os'
import { randomBytes } from 'node:crypto'
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'

// ---------- secp256k1 affine arithmetic (BigInt) ----------
const P = 2n ** 256n - 2n ** 32n - 977n
const N_ORDER = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n
const GX = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n
const GY = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n
type Pt = { x: bigint; y: bigint } | null

const mod = (a: bigint) => { const r = a % P; return r < 0n ? r + P : r }
function inv(a: bigint): bigint {
  // extended Euclid
  let [r0, r1] = [mod(a), P]
  let [s0, s1] = [1n, 0n]
  while (r1 !== 0n) {
    const q = r0 / r1
    ;[r0, r1] = [r1, r0 - q * r1]
    ;[s0, s1] = [s1, s0 - q * s1]
  }
  return mod(s0)
}
function add(a: Pt, b: Pt): Pt {
  if (!a) return b
  if (!b) return a
  if (a.x === b.x) {
    if (mod(a.y + b.y) === 0n) return null
    const l = mod(3n * a.x * a.x * inv(2n * a.y))
    const x = mod(l * l - 2n * a.x)
    return { x, y: mod(l * (a.x - x) - a.y) }
  }
  const l = mod((b.y - a.y) * inv(b.x - a.x))
  const x = mod(l * l - a.x - b.x)
  return { x, y: mod(l * (a.x - x) - a.y) }
}
function mul(k: bigint, p: Pt): Pt {
  let r: Pt = null
  let q = p
  while (k > 0n) {
    if (k & 1n) r = add(r, q)
    q = add(q, q)
    k >>= 1n
  }
  return r
}

// ---------- keccak-256 of a 64-byte message, generated fully unrolled over 32-bit halves ----------
/** Returns f(w, out): w = 16 little-endian u32 words of input; writes the 8 hash words to out. */
export function makeKeccak64(): (w: Uint32Array, out: Uint32Array) => void {
  // round constants + rotation offsets (FIPS 202), computed rather than transcribed
  const RC: bigint[] = []
  for (let round = 0, R = 1n; round < 24; round++) {
    let t = 0n
    for (let j = 0; j < 7; j++) {
      R = ((R << 1n) ^ ((R >> 7n) * 0x71n)) % 256n
      if (R & 2n) t ^= 1n << ((1n << BigInt(j)) - 1n)
    }
    RC.push(t)
  }
  const rot: number[][] = Array.from({ length: 5 }, () => [0, 0, 0, 0, 0])
  for (let t = 0, x = 1, y = 0; t < 24; t++) {
    rot[x]![y] = (((t + 1) * (t + 2)) / 2) % 64
    ;[x, y] = [y, (2 * x + 3 * y) % 5]
  }
  const L = (x: number, y: number) => 2 * (x + 5 * y) // lane (x,y): lo word index; hi = +1
  const rotl = (lo: string, hi: string, r: number): [string, string] => {
    if (r === 0) return [lo, hi]
    if (r === 32) return [hi, lo]
    if (r < 32) return [`((${lo} << ${r}) | (${hi} >>> ${32 - r}))`, `((${hi} << ${r}) | (${lo} >>> ${32 - r}))`]
    const s = r - 32
    return [`((${hi} << ${s}) | (${lo} >>> ${32 - s}))`, `((${lo} << ${s}) | (${hi} >>> ${32 - s}))`]
  }
  const a = (i: number) => `a${i}`
  const b = (i: number) => `b${i}`
  let body = ''
  // theta
  for (let x = 0; x < 5; x++) {
    body += `c${2 * x} = ${[0, 1, 2, 3, 4].map((y) => a(L(x, y))).join(' ^ ')};\n`
    body += `c${2 * x + 1} = ${[0, 1, 2, 3, 4].map((y) => a(L(x, y) + 1)).join(' ^ ')};\n`
  }
  for (let x = 0; x < 5; x++) {
    const p = (x + 4) % 5, n = (x + 1) % 5
    const [rl, rh] = rotl(`c${2 * n}`, `c${2 * n + 1}`, 1)
    body += `dl = c${2 * p} ^ ${rl}; dh = c${2 * p + 1} ^ ${rh};\n`
    for (let y = 0; y < 5; y++) body += `${a(L(x, y))} ^= dl; ${a(L(x, y) + 1)} ^= dh;\n`
  }
  // rho + pi: B[y, 2x+3y] = rot(A[x,y])
  for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) {
    const [rl, rh] = rotl(a(L(x, y)), a(L(x, y) + 1), rot[x]![y]!)
    const d = L(y, (2 * x + 3 * y) % 5)
    body += `${b(d)} = ${rl}; ${b(d + 1)} = ${rh};\n`
  }
  // chi
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
    const i = L(x, y), i1 = L((x + 1) % 5, y), i2 = L((x + 2) % 5, y)
    body += `${a(i)} = ${b(i)} ^ (~${b(i1)} & ${b(i2)}); ${a(i + 1)} = ${b(i + 1)} ^ (~${b(i1 + 1)} & ${b(i2 + 1)});\n`
  }
  // iota
  body += `a0 ^= RCL[r]; a1 ^= RCH[r];\n`

  // The generated source is built only from the constants above (no external input reaches it).
  const decl = [...Array(50).keys()].map((i) => `a${i} = 0`).concat([...Array(50).keys()].map((i) => `b${i} = 0`), [...Array(10).keys()].map((i) => `c${i} = 0`), ['dl = 0', 'dh = 0'])
  const src = `
    const RCL = new Int32Array([${RC.map((t) => Number(t & 0xffffffffn) | 0).join(',')}]);
    const RCH = new Int32Array([${RC.map((t) => Number(t >> 32n) | 0).join(',')}]);
    return function keccak64(w, out) {
      let ${decl.join(', ')};
      ${[...Array(16).keys()].map((i) => `a${i} = w[${i}] | 0;`).join(' ')}
      a16 = 1; a33 = -2147483648; // pad10*1 for keccak (0x01 … 0x80) at rate 136 bytes
      for (let r = 0; r < 24; r++) {
        ${body}
      }
      ${[...Array(8).keys()].map((i) => `out[${i}] = a${i};`).join(' ')}
    }`
  return new Function(src)() as (w: Uint32Array, out: Uint32Array) => void
}

/** Prefix/suffix nibble masks over hash words 3 (address bytes 0-3) and 7 (address bytes 16-19). */
export function matchMasks(target: string, n: number) {
  const hex = target.toLowerCase().replace(/^0x/, '')
  const bytes = Buffer.from(hex, 'hex')
  const word = (off: number) => (bytes[off]! | (bytes[off + 1]! << 8) | (bytes[off + 2]! << 16) | (bytes[off + 3]! << 24)) | 0
  let mp = 0, ms = 0
  for (let q = 0; q < n; q++) mp |= (q % 2 === 0 ? 0xf0 : 0x0f) << (8 * (q >> 1)) // nibble q of the address
  for (let q = 40 - n; q < 40; q++) ms |= (q % 2 === 0 ? 0xf0 : 0x0f) << (8 * ((q >> 1) - 16))
  return { tp: word(0) & mp, mp: mp | 0, ts: word(16) & ms, ms: ms | 0 }
}

// ---------- worker ----------
function runWorker() {
  const { k0hex, target, n, walkers: M } = workerData as { k0hex: string; target: string; n: number; walkers: number }
  const keccak = makeKeccak64()
  const { tp, mp, ts, ms } = matchMasks(target, n)
  const k0 = BigInt('0x' + k0hex) % N_ORDER || 1n
  // walker j starts at (k0 + j)·G; every step adds Q = M·G, so walker j at step s holds key k0 + j + s·M
  const xs: bigint[] = new Array(M), ys: bigint[] = new Array(M)
  let p = mul(k0, { x: GX, y: GY })!
  for (let j = 0; j < M; j++) { xs[j] = p.x; ys[j] = p.y; p = add(p, { x: GX, y: GY })! }
  const Q = mul(BigInt(M), { x: GX, y: GY })!
  const qx = Q.x, qy = Q.y
  const ds: bigint[] = new Array(M), pre: bigint[] = new Array(M)
  const buf = new ArrayBuffer(64), dv = new DataView(buf), w = new Uint32Array(buf), out = new Uint32Array(8)
  const MASK = 0xffffffffffffffffn
  let step = 0n, sinceReport = 0, lastReport = Date.now()
  for (;;) {
    let acc = 1n
    for (let j = 0; j < M; j++) {
      let d = qx - xs[j]!; if (d < 0n) d += P
      ds[j] = d; pre[j] = acc; acc = (acc * d) % P
    }
    let iv = inv(acc)
    step++
    for (let j = M - 1; j >= 0; j--) {
      const id = (iv * pre[j]!) % P
      iv = (iv * ds[j]!) % P
      const x1 = xs[j]!, y1 = ys[j]!
      let dy = qy - y1; if (dy < 0n) dy += P
      const l = (dy * id) % P
      let x3 = (l * l) % P - x1 - qx; if (x3 < 0n) { x3 += P; if (x3 < 0n) x3 += P }
      let dx = x1 - x3; if (dx < 0n) dx += P
      let y3 = (l * dx) % P - y1; if (y3 < 0n) y3 += P
      xs[j] = x3; ys[j] = y3
      dv.setBigUint64(0, x3 >> 192n); dv.setBigUint64(8, (x3 >> 128n) & MASK); dv.setBigUint64(16, (x3 >> 64n) & MASK); dv.setBigUint64(24, x3 & MASK)
      dv.setBigUint64(32, y3 >> 192n); dv.setBigUint64(40, (y3 >> 128n) & MASK); dv.setBigUint64(48, (y3 >> 64n) & MASK); dv.setBigUint64(56, y3 & MASK)
      keccak(w, out)
      if (((out[3]! ^ tp) & mp) === 0 && ((out[7]! ^ ts) & ms) === 0) {
        const key = (k0 + BigInt(j) + step * BigInt(M)) % N_ORDER
        parentPort!.postMessage({ found: key.toString(16).padStart(64, '0') })
      }
    }
    sinceReport += M
    if (Date.now() - lastReport > 2000) { parentPort!.postMessage({ tried: sinceReport }); sinceReport = 0; lastReport = Date.now() }
  }
}

// ---------- main ----------
async function main() {
  const { privateKeyToAddress } = await import('viem/accounts')
  const { keccak256 } = await import('viem')
  const { requireTestnet, needKey, setEnv, SERVER_ENV, writeWebEnv, die } = await import('./lib')
  requireTestnet()
  const arg = (name: string, dflt: number) => { const i = process.argv.indexOf(name); return i >= 0 ? Number(process.argv[i + 1]) : dflt }
  const chars = arg('--chars', 4)
  const minutes = arg('--minutes', 60)
  const target = privateKeyToAddress(needKey('DEMO_PAYEE_PRIVATE_KEY'))

  // self-test the generated keccak against viem before trusting it
  const k = makeKeccak64(), o = new Uint32Array(8)
  for (let t = 0; t < 50; t++) {
    const msg = randomBytes(64)
    k(new Uint32Array(msg.buffer, msg.byteOffset, 16), o)
    if (Buffer.from(o.buffer).toString('hex') !== keccak256(msg).slice(2)) die('keccak self-test failed')
  }

  const mine = (n: number, capMs: number) => new Promise<{ key: `0x${string}`; ms: number; tried: number } | null>((resolveMine) => {
    const threads = availableParallelism()
    const walkers = 2048
    const started = Date.now()
    let tried = 0, lastPrint = started, done = false
    const expected = 16 ** (2 * n)
    console.log(`mining ${n}+${n} lookalike of ${target} (${target.slice(0, 2 + n)}…${target.slice(-n)}) on ${threads} threads, cap ${Math.round(capMs / 60000)} min, expected ~${expected.toExponential(2)} tries`)
    const workers: Worker[] = []
    const finish = (r: { key: `0x${string}`; ms: number; tried: number } | null) => {
      if (done) return
      done = true
      clearTimeout(timer)
      for (const w of workers) void w.terminate()
      resolveMine(r)
    }
    const timer = setTimeout(() => finish(null), capMs)
    for (let i = 0; i < threads; i++) {
      const w = new Worker(fileURLToPath(import.meta.url), { workerData: { k0hex: randomBytes(32).toString('hex'), target, n, walkers } })
      w.on('message', (m: { tried?: number; found?: string }) => {
        if (m.tried) {
          tried += m.tried
          const now = Date.now()
          if (now - lastPrint > 15000) {
            lastPrint = now
            const rate = tried / ((now - started) / 1000)
            console.log(`  ${((now - started) / 60000).toFixed(1)} min · ${(tried / 1e6).toFixed(0)}M tried · ${(rate / 1e6).toFixed(2)}M/s · ~${(expected / rate / 60).toFixed(0)} min expected on average`)
          }
        }
        if (m.found) {
          const key = `0x${m.found}` as `0x${string}`
          const addr = privateKeyToAddress(key).toLowerCase()
          const t = target.toLowerCase()
          if (addr !== t && addr.slice(2, 2 + n) === t.slice(2, 2 + n) && addr.slice(-n) === t.slice(-n)) finish({ key, ms: Date.now() - started, tried })
          else console.log(`  (discarding a candidate that did not re-derive: ${addr})`)
        }
      })
      w.on('error', (e) => { console.error('worker error', e); finish(null) })
      workers.push(w)
    }
  })

  let n = chars
  let r = await mine(n, minutes * 60_000)
  if (!r && n > 3) {
    console.log(`no ${n}+${n} match within ${minutes} min: falling back to 3+3 (LOOKALIKE_CHARS=3)`)
    n = 3
    r = await mine(n, 30 * 60_000)
  }
  if (!r) die('no lookalike found')
  const address = privateKeyToAddress(r.key)
  setEnv(SERVER_ENV, { LAB_LOOKALIKE_PRIVATE_KEY: r.key, LAB_LOOKALIKE_ADDRESS: address, LOOKALIKE_CHARS: String(n) })
  writeWebEnv()
  console.log(JSON.stringify({ payee: target, lookalike: address, chars: n, minutes: +(r.ms / 60000).toFixed(1), tried: r.tried, NEXT_PUBLIC_LAB_LOOKALIKE: address }, null, 2))
  process.exit(0)
}

if (isMainThread) await main()
else runWorker()
