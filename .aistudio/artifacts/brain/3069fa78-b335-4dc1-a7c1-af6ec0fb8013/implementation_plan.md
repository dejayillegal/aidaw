# Mobile Migration, Audio Stability, Lossless Master Export & Dynamic Arrangements

This implementation plan details the architectural upgrades to deliver native-grade Android and iOS support, eliminate audio crackling during UI interactions, guarantee lossless master track exports, and introduce dynamic arrangement lengths and staggered layer staging.

## 1. Overview & Core Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    SoundCraft Studio Shell                   │
├──────────────────────────────┬───────────────────────────────┤
│  Android / iOS PWA / Native  │  Adaptive Web Audio Engine    │
│  - Web App Manifest          │  - Decoupled React Renders    │
│  - PWAInstallButton          │  - 50ms Lookahead Buffer      │
│  - Touch DAW Layout & Safe   │  - AudioWorklet / RAF Buffer  │
└──────────────┬───────────────┴──────────────┬────────────────┘
               │                              │
               ▼                              ▼
┌──────────────────────────────┬───────────────────────────────┤
│   Lossless Master Export     │  Dynamic Arrangement Engine   │
│  - Full Offline WAV Render   │  - 24-128 Bar Randomization   │
│  - 24-bit / 32-bit Float     │  - Staggered Layer Entry/Exit │
└──────────────────────────────┴───────────────────────────────┘
```

## 2. Key Upgrades & Technical Strategy

### A. Android & iOS Mobile Migration (PWA & Capacitor Config)
- **Web App Manifest (`public/manifest.json` & Vite PWA)**: Configure `id`, `name`, `short_name` (≤ 12 chars), `start_url`, `display: 'standalone'`, `theme_color`, and 192x192 / 512x512 PNG icons.
- **iOS Safari Metadata**: Add `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`, and `apple-touch-icon.png` (180x180 PNG).
- **In-App Install Prompt (`PWAInstallButton.tsx`)**: Mount an install button in the studio transport or header that captures `beforeinstallprompt` on Android/Chrome and provides step-by-step Home Screen instructions for iOS Safari.
- **Capacitor Mobile Config (`capacitor.config.ts`)**: Add configuration for native iOS and Android packaging (`com.soundcraft.daw`, webDir `dist`, audio background modes).

### B. Audio Crackling Elimination (Decoupled Renders & Adaptive Buffer)
- **Decouple React State from Web Audio Loop**: Move high-frequency playhead updates (`requestAnimationFrame`) and metering out of heavy React state setters into direct DOM refs or throttled batch updates (`requestAnimationFrame` at 30Hz for UI canvas, 60Hz for audio scheduler).
- **Adaptive Lookahead Buffer**: Implement an adaptive Web Audio lookahead scheduler (`schedulerIntervalMs = 25`, `scheduleAheadTime = 0.100s`) running on `setInterval` with a dedicated reference clock to prevent audio buffer starvation during heavy component re-renders or tab switching.

### C. Lossless Master Track Export (`losslessWavExport.ts`)
- **Offline Audio Context Rendering**: Build an offline rendering pipeline that synthesizes all active tracks, notes, automation curves, and mixer effects from Bar 1 to the exact arrangement end (e.g., 64 or 128 bars) at 44.1kHz/48kHz 24-bit PCM or 32-bit float WAV.
- **Complete Track Integrity**: Ensure no clipping occurs during export by passing through the master limiter (-1.0 dBTP ceiling, BS.1770 LUFS staging) prior to blob generation.

### D. Dynamic Arrangement & Layering Engine (`compositionIntelligenceEngine.ts`)
- **Variable Arrangement Lengths**: Support dynamic bar counts (24, 32, 48, 64, 96, 128 bars) across different project templates and AI reference imports rather than forcing a uniform 16-bar loop.
- **Staggered Layer Entry & Exit**: Implement algorithmic arrangement section contours (Intro, Groove Establish, Hypnotic Lock, Tension Riser, Breakdown, Peak Drop, Outro) where tracks enter and exit dynamically across bars.
