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

const PORT = process.env.PORT || 5000;

app.listen(PORT, async (err) => {
  if (err) {
    console.error("❌ SERVER FAILED:", err);
  } else {
    console.log(`🚀 Server running on port ${PORT}`);
    try {
      await prisma.$queryRaw`SELECT 1`;
      console.log(`✅ Database connected successfully (MySQL: deephysio)`);
      
      // Initialize Automatic 7-Day Admin Email Backup Scheduler
      const { initBackupScheduler } = require('./modules/backup/backupScheduler.service');
      await initBackupScheduler();

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
  }
});



