-- Restaurant Reports, Step 1: the business day's start (default midnight, so
-- nothing changes until it's set in Restaurant › Touch POS), and the new
-- "View Cost" permission (cost and margin columns). The Administrator has
-- every permission; the built-in Manager role is given it here (the roles
-- matrix can move it). Nothing else changes.

-- AlterTable
ALTER TABLE `BusinessSetting` ADD COLUMN `restaurantDayStartMinutes` INTEGER NOT NULL DEFAULT 0;

INSERT IGNORE INTO `RolePermission` (`id`, `roleId`, `permission`)
  SELECT REPLACE(UUID(), '-', ''), `id`, 'View Cost'
  FROM `Role`
  WHERE `systemRole` = 'MANAGER' AND `deletedAt` IS NULL;
