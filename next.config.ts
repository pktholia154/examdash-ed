import type { NextConfig } from 'next';

const isProd = process.env.NODE_ENV === 'production';
// In `next dev`, route chunks (`app/page.js`, `app/layout.js`, `app/books/[slug]/page.js`,
// `app-pages-internals.js`) have unhashed filenames. Assigning a per-boot `deploymentId`
// appends `?dpl=dev-<ts>` to every static chunk URL and RSC manifest entry in development,
// guaranteeing browsers and cross-origin preview iframes never reuse stale cached chunks.
const devDeploymentId = isProd ? undefined : `dev-${Date.now()}`;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  compress: true,
  poweredByHeader: false,
  deploymentId: isProd ? process.env.NEXT_DEPLOYMENT_ID || undefined : devDeploymentId,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  output: 'standalone',
  transpilePackages: ['motion'],
  async headers() {
    return [
      {
        source: '/_next/static/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: isProd
              ? 'public, max-age=31536000, immutable'
              : 'no-store, must-revalidate',
          },
        ],
      },
      {
        source: '/.well-known/apple-app-site-association',
        headers: [
          { key: 'Content-Type', value: 'application/json; charset=utf-8' },
          { key: 'Cache-Control', value: 'public, max-age=3600, s-maxage=3600' },
        ],
      },
      {
        source: '/.well-known/assetlinks.json',
        headers: [
          { key: 'Content-Type', value: 'application/json; charset=utf-8' },
          { key: 'Cache-Control', value: 'public, max-age=3600, s-maxage=3600' },
        ],
      },
      {
        source: '/api/:path*',
        headers: [
          { key: 'Cache-Control', value: 'private, no-cache, no-store, max-age=0' },
        ],
      },
      {
        source: '/((?!api|_next/static|_next/image|favicon.ico).*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
  webpack: (config, { dev, isServer, webpack }) => {
    // HMR is disabled in AI Studio via DISABLE_HMR env var.
    // Do not modify—file watching is disabled to prevent flickering during agent edits.
    if (dev && process.env.DISABLE_HMR === 'true') {
      config.watchOptions = {
        ignored: /.*/,
      };
    }

    // clawpdf includes optional Node CLI dynamic imports (`node:fs/promises`, `node:module`, `node:url`, `node:zlib`)
    // that are never executed inside the browser PDFium WASM Web Worker.
    if (!isServer) {
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(/^node:/, (resource: { request: string }) => {
          resource.request = resource.request.replace(/^node:/, '');
        })
      );
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        'fs/promises': false,
        module: false,
        url: false,
        zlib: false,
        path: false,
        crypto: false,
      };
    }

    return config;
  },
};

export default nextConfig;
