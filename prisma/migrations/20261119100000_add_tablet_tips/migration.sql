-- Restaurant: the tablet's PAY asks for a tip (Settings › Restaurant ›
-- Payments). Off for every business until it's switched on.

-- AlterTable
ALTER TABLE `BusinessSetting` ADD COLUMN `restaurantTabletTips` BOOLEAN NOT NULL DEFAULT false;
