# Rider PWA (`apps/rider-pwa`) — Lighthouse PWA & Performance Report

This document records the production build size, Lighthouse 11 PWA/performance audit results, and offline/installability checks for `@mallaka/rider-pwa` (README sections 1, 4, 10, and 12).

## Reproduce Locally

```bash
pnpm --filter @mallaka/rider-pwa build
cd apps/rider-pwa
npx next start -p 3000 -H 127.0.0.1 &

CHROME_PATH=/usr/bin/google-chrome npx lighthouse@11 http://127.0.0.1:3000/ \
  --only-categories=performance,accessibility,best-practices,seo,pwa \
  --chrome-flags="--headless=new --no-sandbox --disable-gpu --no-first-run --no-default-browser-check --ignore-certificate-errors --disable-features=HttpsFirstBalancedModeAutoEnable,HttpsUpgrades"
```

## Environment

- **Lighthouse**: `11.7.1` (mobile emulation default: Moto G Power, simulated Slow 4G)
- **Browser**: `HeadlessChrome/156.0.0.0` (`Linux x86_64`)
- **App build**: Next.js `14.2.35` production build (`next start -p 3000 -H 127.0.0.1`)

## Category Scores

| Category | Score |
|---|---|
| **Performance** | **96 / 100** |
| **Accessibility** | **100 / 100** |
| **Best Practices** | **100 / 100** |
| **SEO** | **100 / 100** |
| **PWA** | **100 / 100** |

## Core Web Vitals & Timing Metrics (Simulated Slow 4G)

| Metric | Value |
|---|---|
| First Contentful Paint (FCP) | `0.8 s` |
| Speed Index | `0.8 s` |
| Largest Contentful Paint (LCP) | `2.2 s` |
| Time to Interactive (TTI) | `2.2 s` |
| Total Blocking Time (TBT) | `170 ms` |
| Cumulative Layout Shift (CLS) | `0` |

## PWA Installability & Offline Checks

| Audit | Result | Notes |
|---|---|---|
| `installable-manifest` | Pass (`1`) | `public/manifest.webmanifest` (`display: "standalone"`, `start_url: "/"`) + `public/sw.js` registered |
| `splash-screen` | Pass (`1`) | `icon-192.png` + `icon-512.png`, `background_color: "#f8fafc"`, `theme_color: "#065f46"` |
| `maskable-icon` | Pass (`1`) | `icon-512.png` declared with `purpose: "any maskable"` |
| `themed-omnibox` | Pass (`1`) | Viewport `themeColor: "#065f46"` |
| `viewport` / `content-width` | Pass (`1`) | Mobile-first single-column layout (`max-w-md`), minimum `48px` (`min-h-12`) tap targets |
| Offline lease state | Verified in unit tests & SW | `sw.js` caches app shell + `/api/v1/leases*` GET responses (network-first, cache fallback) and `localStorage` (`src/lib/offline.ts`) displays the last known lease state clearly labelled **"Last updated … (offline copy)"** |

## Bundle Budget

- **Route `/` size**: `7.34 kB`
- **First Load JS shared by all**: `94.5 kB` (zero UI component libraries, icon packs, or crypto SDKs in the browser bundle)
- **Language / jargon check**: Automated test suite asserts no rendered screen contains `wallet`, `stellar`, `soroban`, `xlm`, `usdc`, `blockchain`, `token`, `gas`, or transaction hashes.
