# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **Cloudflare Workers-based Docker registry proxy** that allows proxying requests to multiple Docker registries (Docker Hub, Quay, GCR, GHCR, etc.) through a single Cloudflare Worker. It's designed for use with custom domains or Cloudflare Workers subdomains.

**Important Note**: The project is currently not recommended for production use due to Docker Hub rate-limiting issues with Cloudflare Worker IPs.

## Development Commands

- **Build**: `npm run build` (or `yarn build`)
  - Bundles the code with Webpack, outputs to `dist/main.js`
  - Webpack is configured to handle HTML as string imports and `.mjs` files

- **Development Server**: `npm run dev` (or `yarn dev`)
  - Runs local Cloudflare Worker using Wrangler on `http://0.0.0.0:8787`
  - Uses dev environment configuration (debug mode, single upstream)

- **Format Code**: `npm run format`
  - Runs Prettier on all `.js`, `.css`, `.json`, and `.md` files

- **Deploy**: Automated via GitHub Actions on push to `master` branch
  - Uses Wrangler to deploy to Cloudflare Workers
  - Requires `CF_API_TOKEN` and `CF_ACCOUNT_ID` secrets
  - Requires `CUSTOM_DOMAIN` secret (defaults to `libcuda.so`)

## Architecture

### Core Request Flow

The worker handles incoming requests and routes them based on hostname to appropriate Docker registries:

1. **Request Entry** (`addEventListener("fetch")`): All requests start here
2. **Root Path Handler**: `/` returns HTML documentation (from `src/help.html`)
3. **Host-based Routing** (`routeByHosts`): Maps hostname to upstream registry URL
4. **Authentication Flow**: Handles OAuth2 token flow for private registries
5. **Request Proxying**: Forwards requests to upstream with special handling for Docker Hub

### Key Request Paths

- `GET /`: Returns HTML help page
- `GET /v2/`: Registry auth check (returns 401 if unauthorized)
- `GET /v2/auth`: Token acquisition endpoint
  - Parses `WWW-Authenticate` header from upstream
  - Auto-completes library prefix for Docker Hub (e.g., `busybox` → `library/busybox`)
  - Forwards user credentials if provided
- `/*`: All other paths proxied to upstream registry

### Docker Hub Special Cases

1. **Library Image Prefix**: Docker Hub requires `library/` prefix for official images
   - Auto-redirect: `/v2/busybox/...` → `/v2/library/busybox/...`
   - Auto-scope completion: `repository:busybox:pull` → `repository:library/busybox:pull`

2. **Blob Redirect Handling**: Manually follows 307 redirects for blob downloads
   - Prevents passthrough to upstream without following redirect

### Configuration

**Routes** are defined in `src/index.js` and use the `CUSTOM_DOMAIN` environment variable:
- `docker.{CUSTOM_DOMAIN}` → Docker Hub
- `quay.{CUSTOM_DOMAIN}` → Quay.io
- `gcr.{CUSTOM_DOMAIN}` → Google Container Registry
- `k8s-gcr.{CUSTOM_DOMAIN}` → Google Kubernetes GCR
- `k8s.{CUSTOM_DOMAIN}` → Kubernetes Registry
- `ghcr.{CUSTOM_DOMAIN}` → GitHub Container Registry
- `cloudsmith.{CUSTOM_DOMAIN}` → Cloudsmith
- `ecr.{CUSTOM_DOMAIN}` → AWS Public ECR
- `docker-staging.{CUSTOM_DOMAIN}` → Docker Hub (staging only)

**Environment Variables** (set in `wrangler.toml`):
- `CUSTOM_DOMAIN`: The base domain for routing (default: `libcuda.so`)
- `MODE`: `debug`, `staging`, or `production` - affects error responses and routing behavior
- `TARGET_UPSTREAM`: In debug mode, single upstream to proxy all requests to

### Deployment Configuration

**wrangler.toml**:
- **Dev Environment**: Runs locally with debug mode, proxies to Docker Hub upstream
- **Production Environment**: Deployed to Cloudflare Workers with multiple routes via `CUSTOM_DOMAIN`
- **Staging Environment**: Separate deployment for testing

**GitHub Actions** (`.github/workflows/deploy.yaml`):
- Triggers on push to `master` (ignores markdown files)
- Deploys to production environment automatically
- Requires secrets: `CF_API_TOKEN`, `CF_ACCOUNT_ID`, `CUSTOM_DOMAIN`

## Common Development Scenarios

### Testing a Single Registry Proxy

Set environment variables in `wrangler.toml` `[env.dev.vars]`:
```toml
TARGET_UPSTREAM = "https://quay.io"  # Or any registry
```

Then run `npm run dev` to test locally.

### Adding a New Registry Route

1. Add new entry to `routes` object in `src/index.js`
2. If the registry requires special handling (like Docker Hub's library prefix), add logic in appropriate handler functions
3. Test locally with `npm run dev`, then rebuild and redeploy

### Testing Authentication Flow

Make requests to `/v2/auth` with `Authorization` header to test token acquisition:
```bash
curl -H "Authorization: Bearer token" http://localhost:8787/v2/auth?scope=...
```

## File Structure

- `src/index.js`: Main worker logic and request handlers
- `src/help.html`: HTML response for root path
- `webpack.config.js`: Webpack build configuration (targets webworker)
- `wrangler.toml`: Cloudflare Workers configuration and environments
- `package.json`: Dependencies and build scripts
