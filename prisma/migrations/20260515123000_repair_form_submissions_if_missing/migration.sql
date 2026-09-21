-- Repair: imports may sync `_prisma_migrations` without creating newer tables.
-- Safe if table already exists (no-op).
CREATE TABLE IF NOT EXISTS `form_submissions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `patient_id` INTEGER NOT NULL,
    `form_template_id` INTEGER NOT NULL,
    `responses` LONGTEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `form_submissions_patient_id_idx`(`patient_id`),
    INDEX `form_submissions_form_template_id_idx`(`form_template_id`),
    PRIMARY KEY (`id`),
    CONSTRAINT `form_submissions_patient_id_fkey` FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `form_submissions_form_template_id_fkey` FOREIGN KEY (`form_template_id`) REFERENCES `form_templates`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
