-- CreateTable (Prisma model SystemActivityLog @@map("system_activity_logs"))
CREATE TABLE `system_activity_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NULL,
    `action` ENUM(
        'LOGIN',
        'CREATE_APPOINTMENT',
        'UPDATE_APPOINTMENT',
        'CREATE_PATIENT',
        'UPDATE_PATIENT',
        'CREATE_NOTE',
        'UPDATE_NOTE',
        'CREATE_INVOICE',
        'PAY_INVOICE',
        'UPDATE_SETTINGS'
    ) NOT NULL,
    `target_id` VARCHAR(191) NULL,
    `target_type` VARCHAR(191) NULL,
    `details` VARCHAR(191) NULL,
    `meta` LONGTEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `system_activity_logs_created_at_idx`(`created_at`),
    INDEX `system_activity_logs_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `system_activity_logs` ADD CONSTRAINT `system_activity_logs_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
