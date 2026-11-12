-- Part 6e Step 3: the touch POS Note keypad's quick notes (a JSON list of
-- strings; NULL: the default list).

-- AlterTable
ALTER TABLE `BusinessSetting` ADD COLUMN `restaurantQuickNotes` JSON NULL;
