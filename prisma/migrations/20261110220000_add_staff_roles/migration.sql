-- Part 6f Step 2: staff roles. Each role gets an access level (SERVICE: the
-- service screens only; BACK_OFFICE: the back office too) and a home screen;
-- the six built-in roles carry a key (Role.systemRole) and can't be deleted.
-- Existing roles with those names are adopted (people and permissions kept;
-- "Bar" becomes "Bartender"); any still missing are created with default
-- permissions.

-- AlterTable
ALTER TABLE `Role` ADD COLUMN `accessLevel` ENUM('SERVICE', 'BACK_OFFICE') NOT NULL DEFAULT 'SERVICE',
    ADD COLUMN `homeAreaId` VARCHAR(191) NULL,
    ADD COLUMN `homeScreen` ENUM('TABLES', 'BAR', 'CASHIER', 'KITCHEN') NOT NULL DEFAULT 'TABLES',
    ADD COLUMN `homeStation` VARCHAR(20) NULL,
    ADD COLUMN `systemRole` ENUM('ADMINISTRATOR', 'MANAGER', 'CASHIER', 'WAITER', 'BARTENDER', 'KITCHEN') NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Role_systemRole_key` ON `Role`(`systemRole`);

-- AddForeignKey
ALTER TABLE `Role` ADD CONSTRAINT `Role_homeAreaId_fkey` FOREIGN KEY (`homeAreaId`) REFERENCES `DiningArea`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- ---- Adopt the roles that already exist (live ones first, by name).
-- The Administrator: the isSystem role (every permission, as before).
UPDATE `Role` SET `systemRole` = 'ADMINISTRATOR' WHERE `isSystem` = 1 AND `deletedAt` IS NULL ORDER BY `createdAt` LIMIT 1;
UPDATE `Role` SET `systemRole` = 'MANAGER' WHERE `name` = 'Manager' AND `deletedAt` IS NULL AND `systemRole` IS NULL;
UPDATE `Role` SET `systemRole` = 'CASHIER' WHERE `name` = 'Cashier' AND `deletedAt` IS NULL AND `systemRole` IS NULL;
UPDATE `Role` SET `systemRole` = 'WAITER' WHERE `name` = 'Waiter' AND `deletedAt` IS NULL AND `systemRole` IS NULL;
UPDATE `Role` SET `systemRole` = 'KITCHEN' WHERE `name` = 'Kitchen' AND `deletedAt` IS NULL AND `systemRole` IS NULL;
UPDATE `Role` SET `systemRole` = 'BARTENDER' WHERE `name` = 'Bartender' AND `deletedAt` IS NULL AND `systemRole` IS NULL;
-- "Bar" becomes the Bartender (renamed) — unless a role is already called Bartender.
UPDATE `Role` r
  JOIN (SELECT COUNT(*) AS taken FROM `Role` WHERE `name` = 'Bartender' OR `systemRole` = 'BARTENDER') x
  SET r.`name` = 'Bartender', r.`systemRole` = 'BARTENDER'
  WHERE r.`name` = 'Bar' AND r.`deletedAt` IS NULL AND r.`systemRole` IS NULL AND x.taken = 0;

-- A deleted role with a built-in role's name comes back as it (the name is
-- unique, so a new one couldn't take it).
UPDATE `Role` r
  JOIN (SELECT COUNT(*) AS taken FROM `Role` WHERE `systemRole` = 'MANAGER') x
  SET r.`systemRole` = 'MANAGER', r.`deletedAt` = NULL WHERE r.`name` = 'Manager' AND r.`systemRole` IS NULL AND x.taken = 0;
UPDATE `Role` r
  JOIN (SELECT COUNT(*) AS taken FROM `Role` WHERE `systemRole` = 'CASHIER') x
  SET r.`systemRole` = 'CASHIER', r.`deletedAt` = NULL WHERE r.`name` = 'Cashier' AND r.`systemRole` IS NULL AND x.taken = 0;
UPDATE `Role` r
  JOIN (SELECT COUNT(*) AS taken FROM `Role` WHERE `systemRole` = 'WAITER') x
  SET r.`systemRole` = 'WAITER', r.`deletedAt` = NULL WHERE r.`name` = 'Waiter' AND r.`systemRole` IS NULL AND x.taken = 0;
UPDATE `Role` r
  JOIN (SELECT COUNT(*) AS taken FROM `Role` WHERE `systemRole` = 'KITCHEN') x
  SET r.`systemRole` = 'KITCHEN', r.`deletedAt` = NULL WHERE r.`name` = 'Kitchen' AND r.`systemRole` IS NULL AND x.taken = 0;
UPDATE `Role` r
  JOIN (SELECT COUNT(*) AS taken FROM `Role` WHERE `systemRole` = 'BARTENDER') x
  SET r.`systemRole` = 'BARTENDER', r.`deletedAt` = NULL WHERE r.`name` = 'Bartender' AND r.`systemRole` IS NULL AND x.taken = 0;

-- ---- Create any still missing (a fresh install), with default permissions.
INSERT INTO `Role` (`id`, `name`, `isSystem`, `systemRole`, `createdAt`, `updatedAt`)
  SELECT UUID(), n.`name`, 0, n.`role`, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
  FROM (
    SELECT 'Manager' AS `name`, 'MANAGER' AS `role` UNION ALL
    SELECT 'Cashier', 'CASHIER' UNION ALL
    SELECT 'Waiter', 'WAITER' UNION ALL
    SELECT 'Bartender', 'BARTENDER' UNION ALL
    SELECT 'Kitchen', 'KITCHEN'
  ) n
  WHERE NOT EXISTS (SELECT 1 FROM `Role` r WHERE r.`systemRole` = n.`role` OR r.`name` = n.`name`);

-- Their permissions — only for roles that have none yet (created just now),
-- so an adopted role keeps exactly what it had.
INSERT INTO `RolePermission` (`id`, `roleId`, `permission`)
  SELECT UUID(), r.`id`, d.`permission`
  FROM `Role` r
  JOIN (
    SELECT 'MANAGER' AS `role`, 'Restaurant Dashboard' AS `permission` UNION ALL
    SELECT 'MANAGER', 'Manage Food' UNION ALL SELECT 'MANAGER', 'Manage Tables' UNION ALL SELECT 'MANAGER', 'Manage Orders' UNION ALL
    SELECT 'MANAGER', 'Kitchen Display' UNION ALL SELECT 'MANAGER', 'Manage Reservations' UNION ALL SELECT 'MANAGER', 'Restaurant Reports' UNION ALL
    SELECT 'MANAGER', 'Restaurant Settings' UNION ALL SELECT 'MANAGER', 'Manage Kitchen' UNION ALL SELECT 'MANAGER', 'Settle Bill' UNION ALL
    SELECT 'MANAGER', 'Approve Discount' UNION ALL SELECT 'MANAGER', 'Log Waste' UNION ALL SELECT 'MANAGER', 'Approve Waste' UNION ALL
    SELECT 'MANAGER', 'Approve Voids & Refunds' UNION ALL SELECT 'MANAGER', 'Manage Floor Plan' UNION ALL
    SELECT 'MANAGER', 'Manage Dashboard' UNION ALL SELECT 'MANAGER', 'Manage Pos Screen' UNION ALL SELECT 'MANAGER', 'Manage Sale' UNION ALL
    SELECT 'MANAGER', 'Manage Sale Return' UNION ALL SELECT 'MANAGER', 'Manage Reports' UNION ALL SELECT 'MANAGER', 'Manage Customers' UNION ALL
    SELECT 'MANAGER', 'Open Drawer' UNION ALL
    SELECT 'CASHIER', 'Manage Orders' UNION ALL SELECT 'CASHIER', 'Settle Bill' UNION ALL SELECT 'CASHIER', 'Open Drawer' UNION ALL
    SELECT 'CASHIER', 'Manage Pos Screen' UNION ALL SELECT 'CASHIER', 'Manage Reservations' UNION ALL
    SELECT 'WAITER', 'Manage Orders' UNION ALL
    SELECT 'BARTENDER', 'Manage Orders' UNION ALL SELECT 'BARTENDER', 'Kitchen Display' UNION ALL SELECT 'BARTENDER', 'Manage Kitchen' UNION ALL
    SELECT 'KITCHEN', 'Kitchen Display' UNION ALL SELECT 'KITCHEN', 'Manage Kitchen' UNION ALL SELECT 'KITCHEN', 'Log Waste'
  ) d ON d.`role` = r.`systemRole`
  WHERE r.`isSystem` = 0 AND NOT EXISTS (SELECT 1 FROM `RolePermission` p WHERE p.`roleId` = r.`id`);

-- ---- Access levels and home screens.
UPDATE `Role` SET `accessLevel` = 'BACK_OFFICE' WHERE `systemRole` IN ('ADMINISTRATOR', 'MANAGER');
UPDATE `Role` SET `homeScreen` = 'BAR' WHERE `systemRole` = 'BARTENDER';
UPDATE `Role` SET `homeScreen` = 'CASHIER' WHERE `systemRole` = 'CASHIER';
UPDATE `Role` SET `homeScreen` = 'KITCHEN' WHERE `systemRole` = 'KITCHEN';
-- The Bartender's Tables screen opens on the bar's area, if one is called "Bar…".
UPDATE `Role` r
  JOIN (SELECT `id` FROM `DiningArea` WHERE `deletedAt` IS NULL AND `name` LIKE 'Bar%' ORDER BY `sortOrder`, `createdAt` LIMIT 1) a
  SET r.`homeAreaId` = a.`id`
  WHERE r.`systemRole` = 'BARTENDER';
