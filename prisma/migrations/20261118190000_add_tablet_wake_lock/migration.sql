-- Restaurant Part 6g, Step 6: keep a tablet's screen on while the app is open
-- (Settings › Restaurant › Touch POS). On for every business.

-- AlterTable
ALTER TABLE `BusinessSetting` ADD COLUMN `restaurantTabletWakeLock` BOOLEAN NOT NULL DEFAULT true;
