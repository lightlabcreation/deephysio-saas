const prisma = require('../src/config/prisma');

async function initWhatsAppTables() {
  console.log('🔄 Checking and creating WhatsApp database tables...');

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS whatsapp_connections (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      tenant_id INT NOT NULL UNIQUE,
      phone_number VARCHAR(32) NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'DISCONNECTED',
      qr_code LONGTEXT NULL,
      connected_at DATETIME NULL,
      last_seen_at DATETIME NULL,
      last_error TEXT NULL,
      session_path VARCHAR(255) NULL,
      notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_wa_tenant (tenant_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS whatsapp_notification_logs (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      tenant_id INT NOT NULL,
      recipient_phone VARCHAR(32) NOT NULL,
      recipient_name VARCHAR(191) NULL,
      recipient_type VARCHAR(32) NOT NULL DEFAULT 'PATIENT',
      event_type VARCHAR(64) NOT NULL,
      message_body TEXT NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
      provider_message_id VARCHAR(191) NULL,
      attempts INT NOT NULL DEFAULT 1,
      error TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_wa_logs_tenant (tenant_id),
      INDEX idx_wa_logs_phone (recipient_phone),
      INDEX idx_wa_logs_event (event_type)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  console.log('✅ WhatsApp tables successfully created/verified in MySQL!');
  await prisma.$disconnect();
}

initWhatsAppTables().catch((err) => {
  console.error('❌ Failed to initialize WhatsApp tables:', err);
  process.exit(1);
});
