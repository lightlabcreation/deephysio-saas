-- Align clinical_notes with Prisma (dynamic SOAP / template payload)
ALTER TABLE `clinical_notes` ADD COLUMN `dynamic_content` LONGTEXT NULL;
