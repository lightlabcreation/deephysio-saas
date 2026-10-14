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

const rawPort = process.env.PORT;
const isPassenger = typeof rawPort === 'string' && rawPort.toLowerCase() === 'passenger';
const isPipeOrSocket = typeof rawPort === 'string' && (rawPort.startsWith('/') || rawPort.startsWith('\\\\') || isPassenger || (isNaN(Number(rawPort)) && rawPort.length > 0));

const onListening = async () => {
  console.log(`🚀 ClinicPilot SaaS API running on ${isPipeOrSocket ? rawPort : `port ${rawPort || 5000} (0.0.0.0)`}`);
  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log(`✅ Database connected successfully (MySQL)`);
    
    // Initialize Automatic 7-Day Admin Email Backup Scheduler
    try {
      const { initBackupScheduler } = require('./modules/backup/backupScheduler.service');
      await initBackupScheduler();
    } catch (schedErr) {
      console.warn('⚠️ [Backup Scheduler] Initialization warning:', schedErr.message);
    }

    // Safely restore persisted WhatsApp sessions if active
    try {
      const { restoreActiveSessionsOnStartup } = require('./modules/whatsapp/whatsapp.service');
      await restoreActiveSessionsOnStartup();
    } catch (waErr) {
      console.warn('⚠️ [WhatsApp] Session startup recovery warning:', waErr.message);
    }
  } catch (dbErr) {
    console.error(`❌ Database connection failed:`, dbErr.message);
  }
};

let server;
if (isPipeOrSocket) {
  server = app.listen(rawPort, onListening);
} else {
  const primaryPort = Number(rawPort) || 5000;
  server = app.listen(primaryPort, '0.0.0.0', onListening);

  // Bind common reverse-proxy ports (5000, 3000, 8080) as fail-safe listeners if free
  const failSafePorts = [5000, 3000, 8080].filter((p) => p !== primaryPort);
  for (const port of failSafePorts) {
    try {
      app.listen(port, '0.0.0.0', () => {
        console.log(`📡 Additional proxy fallback listener active on port ${port}`);
      }).on('error', () => {
        // Silently skip if port is already occupied
      });
    } catch (_) {}
  }
}

server.on('error', (err) => {
  console.error("❌ SERVER LISTEN FAILED:", err);
});



