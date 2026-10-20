import type { NextConfig } from 'next'

// Static export: deployed to Cloudflare Pages as plain files.
const nextConfig: NextConfig = {
  output: 'export',
  images: { unoptimized: true },
}

export default nextConfig
