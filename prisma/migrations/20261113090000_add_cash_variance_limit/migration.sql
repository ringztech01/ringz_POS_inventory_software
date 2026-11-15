-- Restaurant Reports, Step 9: the cash variance limit. A cash-up whose
-- variance (over or short) is more than this shows red in Shifts & cash-up.
-- Default ₦500; set in Restaurant › Touch POS. Nothing else changes.

-- AlterTable
ALTER TABLE `BusinessSetting` ADD COLUMN `restaurantCashVarianceLimit` DECIMAL(12, 2) NOT NULL DEFAULT 500.00;
