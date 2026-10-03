// Server entry point
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



