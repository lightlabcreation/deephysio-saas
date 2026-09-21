-- CreateTable
CREATE TABLE `waitlist` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `patient_id` INTEGER NULL,
    `first_name` VARCHAR(191) NOT NULL,
    `last_name` VARCHAR(191) NOT NULL,
    `service` VARCHAR(191) NOT NULL,
    `preferred_date` DATETIME(3) NULL,
    `preferred_time` VARCHAR(191) NULL,
    `contact_number` VARCHAR(191) NOT NULL,
    `priority` ENUM('HIGH', 'MEDIUM', 'LOW') NOT NULL DEFAULT 'MEDIUM',
    `status` ENUM('WAITING', 'CONFIRMED', 'NO_SHOW') NOT NULL DEFAULT 'WAITING',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `waitlist_patient_id_idx`(`patient_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `waitlist` ADD CONSTRAINT `waitlist_patient_id_fkey` FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
