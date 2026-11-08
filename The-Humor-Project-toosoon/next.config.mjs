import { fileURLToPath } from 'node:url'

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep local route discovery inside this app when parent folders have lockfiles.
  turbopack: {
    root: fileURLToPath(new URL('.', import.meta.url)),
  },
  // The Reaction Joke Maker reads its persona, evaluator, and analysis
  // prompts from docs/prompts at request time. A deployed build only ships
  // the files its routes are traced to import, so without this the folder
  // is missing on Amplify and every /humor-flavor page lists no personas.
  // The key matches any route containing it.
  outputFileTracingIncludes: {
    'humor-flavor': ['./docs/prompts/**/*'],
  },
  experimental: {
    serverActions: {
      // Ops batch runs post whole step records (rendered prompts + raw model
      // outputs) to be archived; a single flush easily passes the 1mb default.
      bodySizeLimit: '8mb',
    },
  },
}

export default nextConfig
