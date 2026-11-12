-- Separate checks at a shared table: a table may carry several open orders
-- (each guest their own bill, payment and receipt). The one-open-order-per-
-- table unique index becomes a plain index; the app decides who may open a
-- check with the table row locked. Each dine-in order gets its check number
-- and an optional guest name.
CREATE INDEX `Order_activeTableId_idx` ON `Order`(`activeTableId`);
DROP INDEX `Order_activeTableId_key` ON `Order`;
ALTER TABLE `Order` ADD COLUMN `checkNumber` INTEGER NULL, ADD COLUMN `checkName` VARCHAR(40) NULL;
UPDATE `Order` SET `checkNumber` = 1 WHERE `tableId` IS NOT NULL;
