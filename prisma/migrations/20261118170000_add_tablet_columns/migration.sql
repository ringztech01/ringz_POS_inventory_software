-- Restaurant Part 6g, Step 5: the tablet Order screen's item columns
-- (2, 3 or 4; Settings › Restaurant › Touch POS). Every business starts on 3.

-- AlterTable
ALTER TABLE `BusinessSetting` ADD COLUMN `restaurantTabletColumns` INTEGER NOT NULL DEFAULT 3;
