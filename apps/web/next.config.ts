import path from 'node:path'
import type { NextConfig } from 'next'

// The pnpm workspace root, so Next doesn't guess it from unrelated lockfiles higher up.
const root = path.join(__dirname, '../..')

const nextConfig: NextConfig = {
  turbopack: { root },
  outputFileTracingRoot: root,
  devIndicators: false,
}

export default nextConfig
