-- Part 6f Step 1: which restaurant screens the app uses — SERVICE (PIN
-- login, the touch Tables screen and Restaurant POS; the default) or CLASSIC
-- (Restaurant › Floor, the Table order page, the retail POS) — for the
-- business, and optionally per device.

-- AlterTable
ALTER TABLE `BusinessSetting` ADD COLUMN `restaurantInterface` ENUM('SERVICE', 'CLASSIC') NOT NULL DEFAULT 'SERVICE';

-- AlterTable
ALTER TABLE `Device` ADD COLUMN `restaurantInterface` ENUM('SERVICE', 'CLASSIC') NULL;
