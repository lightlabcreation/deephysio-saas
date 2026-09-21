-- Prisma schema expects `is_active`; initial create (20260403062900) did not add it.
ALTER TABLE `form_templates` ADD COLUMN `is_active` BOOLEAN NOT NULL DEFAULT true;
