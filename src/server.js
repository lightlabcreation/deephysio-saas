// Server entry point
const fs = require('fs');
const path = require('path');

// Auto-load .env if available without external dependency
const loadEnvFile = (filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      const lines = fs.readFileSync(filePath, 'utf8').split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx !== -1) {
          const key = trimmed.slice(0, eqIdx).trim();
          let val = trimmed.slice(eqIdx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          if (process.env[key] === undefined) {
            process.env[key] = val;
          }
        }
      }
    }
  } catch (_) {}
};

loadEnvFile(path.resolve(__dirname, '../.env'));
loadEnvFile(path.resolve(__dirname, '../../.env'));
loadEnvFile(path.resolve(process.cwd(), '.env'));

const app = require('./app');
const prisma = require('./config/prisma');

// Global crash protection for long-running server instances
process.on('uncaughtException', (err) => {
  console.error('❌ [CRITICAL] Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('❌ [CRITICAL] Unhandled Rejection:', reason);
});

const rawPort = process.env.PORT ? String(process.env.PORT).trim() : null;
const isPassenger = typeof rawPort === 'string' && rawPort.toLowerCase() === 'passenger';
const isPipeOrSocket = typeof rawPort === 'string' && (rawPort.startsWith('/') || rawPort.startsWith('\\\\') || isPassenger);

let isDbInitialized = false;
const initDatabaseAndBackgroundServices = async () => {
  if (isDbInitialized) return;
  isDbInitialized = true;

  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log(`✅ Database connected successfully (MySQL)`);
  } catch (dbErr) {
    console.error(`❌ Database connection warning:`, dbErr.message);
  }

  // Non-blocking initialization of Background Services
  try {
    const { initBackupScheduler } = require('./modules/backup/backupScheduler.service');
    initBackupScheduler().catch((schedErr) => {
      console.warn('⚠️ [Backup Scheduler] Initialization warning:', schedErr.message);
    });
  } catch (schedErr) {
    console.warn('⚠️ [Backup Scheduler] Initialization warning:', schedErr.message);
  }

  try {
    const { restoreActiveSessionsOnStartup } = require('./modules/whatsapp/whatsapp.service');
    restoreActiveSessionsOnStartup().catch((waErr) => {
      console.warn('⚠️ [WhatsApp] Session startup recovery warning:', waErr.message);
    });
  } catch (waErr) {
    console.warn('⚠️ [WhatsApp] Session startup recovery warning:', waErr.message);
  }
};

const activeServers = [];

// Helper to bind a port or socket safely
const startListener = (portOrSocket, isSocket = false) => {
  return new Promise((resolve) => {
    try {
      const serverInstance = isSocket
        ? app.listen(portOrSocket, () => {
            console.log(`🚀 ClinicPilot SaaS API running on socket/pipe: ${portOrSocket}`);
            initDatabaseAndBackgroundServices();
            resolve(serverInstance);
          })
        : app.listen(portOrSocket, '0.0.0.0', () => {
            console.log(`🚀 ClinicPilot SaaS API running on port ${portOrSocket} (0.0.0.0)`);
            initDatabaseAndBackgroundServices();
            resolve(serverInstance);
          });

      serverInstance.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          console.log(`ℹ️ Port ${portOrSocket} is in use by another service, skipping.`);
        } else {
          console.warn(`⚠️ Listener error on ${portOrSocket}:`, err.message);
        }
        resolve(null);
      });
    } catch (_) {
      resolve(null);
    }
  });
};

const startServer = async () => {
  if (isPipeOrSocket) {
    const s = await startListener(rawPort, true);
    if (s) activeServers.push(s);
  }

  const explicitPort = rawPort && !isPipeOrSocket && !isNaN(Number(rawPort)) ? Number(rawPort) : null;

  // Ports to bind so that whichever port the reverse proxy (Caddy/Nginx) expects, this API answers
  const portsToTry = [
    explicitPort,
    5001, // Primary alternative SaaS port (since 5000 is occupied by Master SaaS)
    5000, // Standard default port (if free)
    5002,
    5003,
    5004,
    5005,
    4000,
    4001,
    3001,
    8000,
    8001,
    8081,
    8082
  ].filter((p, idx, arr) => p != null && p > 0 && arr.indexOf(p) === idx);

  for (const port of portsToTry) {
    const s = await startListener(port, false);
    if (s) activeServers.push(s);
  }

  if (activeServers.length === 0) {
    console.error("❌ CRITICAL: Could not bind to any port or socket!");
  } else {
    console.log(`✅ ClinicPilot SaaS API is active on ${activeServers.length} listener(s). Ready for reverse proxy traffic.`);
  }
};

startServer();

module.exports = { app, activeServers };



