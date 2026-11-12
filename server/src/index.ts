import { createAuralisApp } from './app.js';
import { loadConfig } from './config.js';

const cfg = loadConfig();
const { server, orchestrator, local } = createAuralisApp(cfg);

server.listen(cfg.port, cfg.host, () => {
  const providers = orchestrator
    .listProviderStatus()
    .map((p) => `${p.id}(${p.configured ? p.role : 'unconfigured'})`)
    .join(', ');
  console.log(
    `[PlayIT Server] Listening on http://${cfg.host}:${cfg.port} | env=${cfg.nodeEnv} | providers=[${providers}] | referenceTracks=${local.catalogSize}`,
  );
});
