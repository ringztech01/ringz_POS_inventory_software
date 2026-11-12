-- Part 6e Step 5: bar tabs (a name instead of a table) and the touch POS's
-- "after Send" and auto-lock settings.

-- AlterTable
ALTER TABLE `BusinessSetting` ADD COLUMN `restaurantPosLockSeconds` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `restaurantPosSendToFloor` BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE `Order` ADD COLUMN `tabName` VARCHAR(40) NULL,
    MODIFY `type` ENUM('DINE_IN', 'TAKEAWAY', 'DELIVERY', 'BAR_TAB') NOT NULL DEFAULT 'DINE_IN';
