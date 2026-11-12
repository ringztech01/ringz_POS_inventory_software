-- Part 6e Step 7: the touch POS's light theme (off: the dark frame).

-- AlterTable
ALTER TABLE `BusinessSetting` ADD COLUMN `restaurantPosLightTheme` BOOLEAN NOT NULL DEFAULT false;
