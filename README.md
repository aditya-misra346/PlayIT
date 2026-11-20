# PlayIT — Hear it. Know it.

**PlayIT** is an acoustic music recognition web platform.

- **Official Website:** [https://playit-music.vercel.app/](https://playit-music.vercel.app/) *(Live Production Deployment: https://auralis-eight-kohl.vercel.app)*
- **GitHub Repository:** [https://github.com/aditya-misra346/PlayIT](https://github.com/aditya-misra346/PlayIT)

---

## 1. Repository Layout

| Directory | Description |
| :--- | :--- |
| [`docs/CONTRACT.md`](./docs/CONTRACT.md) | Shared specification: brand system, recognition state machine, audio quality gate, normalized `TrackMatch` schema, and HTTP API contract |
| [`server/`](./server/) | Node.js + TypeScript recognition backend: multi-provider orchestrator (`AudD`, `ACRCloud`, `LocalCatalogProvider`), ShazamKit ES256 developer-token signer, Deezer public metadata enricher, rate limiter, cost tracker, and cloud library sync |
| [`web/`](./web/) | React 19 + TypeScript + Vite 6 responsive Web App with Web Audio real-time radial spectrum & RMS visualizer, microphone selector, file recognition, and Acoustic Test Studio |

---

## 2. Quick Start (Web + Backend Server)

```bash
# 1. Run the 17-test server & multi-condition acoustic accuracy suite
cd server
npm test

# 2. Build both backend server and web bundle
cd ..
npm run build

# 3. Start the unified production server (serves API + Web at http://localhost:8787)
npm start
```
