-- Align `users` with Prisma schema (was missing after init migration)
ALTER TABLE `users` ADD COLUMN `allowed_menus` LONGTEXT NULL;
ALTER TABLE `users` ADD COLUMN `allowed_permissions` LONGTEXT NULL;
ALTER TABLE `users` ADD COLUMN `allowed_actions` LONGTEXT NULL;
ALTER TABLE `users` ADD COLUMN `resetPasswordExpires` DATETIME(3) NULL;
ALTER TABLE `users` ADD COLUMN `resetPasswordToken` VARCHAR(255) NULL;
