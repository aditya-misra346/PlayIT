import { createAuralisApp } from '../server/dist/app.js';
import { loadConfig } from '../server/dist/config.js';

let cachedApp = null;

function getApp() {
  if (!cachedApp) {
    const cfg = loadConfig();
    cachedApp = createAuralisApp(cfg);
  }
  return cachedApp;
}

export default async function handler(req, res) {
  const { handleRequest } = getApp();
  await handleRequest(req, res);
}
