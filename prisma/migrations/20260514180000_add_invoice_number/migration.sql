-- AlterTable: add human-readable invoice numbers (DEEPHYSIO-0001, …)
ALTER TABLE `invoices` ADD COLUMN `invoice_number` VARCHAR(32) NULL;

-- Backfill in creation order (first historical invoice → DEEPHYSIO-0001)
UPDATE `invoices` `i`
INNER JOIN (
  SELECT `id`, ROW_NUMBER() OVER (ORDER BY `created_at` ASC) AS `rn`
  FROM `invoices`
) `x` ON `i`.`id` = `x`.`id`
SET `i`.`invoice_number` = CONCAT(
  'DEEPHYSIO-',
  LPAD(CAST(`x`.`rn` AS CHAR), GREATEST(4, LENGTH(CAST(`x`.`rn` AS CHAR))), '0')
);

ALTER TABLE `invoices` MODIFY COLUMN `invoice_number` VARCHAR(32) NOT NULL;

CREATE UNIQUE INDEX `invoices_invoice_number_key` ON `invoices`(`invoice_number`);
