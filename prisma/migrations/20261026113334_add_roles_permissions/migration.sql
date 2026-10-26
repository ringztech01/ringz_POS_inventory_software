-- AlterTable
ALTER TABLE `User` ADD COLUMN `roleId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `Role` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `isSystem` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    UNIQUE INDEX `Role_name_key`(`name`),
    INDEX `Role_deletedAt_idx`(`deletedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RolePermission` (
    `id` VARCHAR(191) NOT NULL,
    `roleId` VARCHAR(191) NOT NULL,
    `permission` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `RolePermission_roleId_permission_key`(`roleId`, `permission`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `User_roleId_idx` ON `User`(`roleId`);

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `Role`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RolePermission` ADD CONSTRAINT `RolePermission_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `Role`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Data: seed roles from the legacy User.role enum and backfill User.roleId.
-- Names reuse the labels the app already shows (lib/roles.ts). Permission
-- strings come from lib/permissions.ts (PERMISSIONS).

-- The system admin role: every permission, can't be deleted.
INSERT INTO `Role` (`id`, `name`, `isSystem`, `createdAt`, `updatedAt`)
VALUES (REPLACE(UUID(), '-', ''), 'Administrator', true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));

-- One role per other distinct value currently in User.role.
INSERT INTO `Role` (`id`, `name`, `isSystem`, `createdAt`, `updatedAt`)
SELECT REPLACE(UUID(), '-', ''),
       CASE r.`role` WHEN 'MANAGER' THEN 'Manager' WHEN 'CASHIER' THEN 'Cashier' END,
       false, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM (SELECT DISTINCT `role` FROM `User` WHERE `role` <> 'ADMIN') AS r;

-- Administrator: all 27.
INSERT INTO `RolePermission` (`id`, `roleId`, `permission`)
SELECT REPLACE(UUID(), '-', ''), ro.`id`, p.`permission`
FROM `Role` ro
CROSS JOIN (
    SELECT 'Manage Adjustments' AS `permission`
    UNION ALL SELECT 'Manage Transfers' AS `permission`
    UNION ALL SELECT 'Manage Roles' AS `permission`
    UNION ALL SELECT 'Manage Brands' AS `permission`
    UNION ALL SELECT 'Manage Currency' AS `permission`
    UNION ALL SELECT 'Manage Warehouses' AS `permission`
    UNION ALL SELECT 'Manage Units' AS `permission`
    UNION ALL SELECT 'Manage Product Categories' AS `permission`
    UNION ALL SELECT 'Manage Products' AS `permission`
    UNION ALL SELECT 'Manage Suppliers' AS `permission`
    UNION ALL SELECT 'Manage Customers' AS `permission`
    UNION ALL SELECT 'Manage Users' AS `permission`
    UNION ALL SELECT 'Manage Expense Categories' AS `permission`
    UNION ALL SELECT 'Manage Expenses' AS `permission`
    UNION ALL SELECT 'Manage Setting' AS `permission`
    UNION ALL SELECT 'Manage Dashboard' AS `permission`
    UNION ALL SELECT 'Manage Pos Screen' AS `permission`
    UNION ALL SELECT 'Manage Purchase' AS `permission`
    UNION ALL SELECT 'Manage Sale' AS `permission`
    UNION ALL SELECT 'Manage Purchase Return' AS `permission`
    UNION ALL SELECT 'Manage Sale Return' AS `permission`
    UNION ALL SELECT 'Manage Email Templates' AS `permission`
    UNION ALL SELECT 'Manage Reports' AS `permission`
    UNION ALL SELECT 'Manage Quotations' AS `permission`
    UNION ALL SELECT 'Manage Sms Templates' AS `permission`
    UNION ALL SELECT 'Manage Sms Apis' AS `permission`
    UNION ALL SELECT 'Manage Language' AS `permission`
) AS p
WHERE ro.`name` = 'Administrator';

-- Manager: exactly what the old static map gave MANAGER (plus Manage Brands /
-- Manage Units, which replaced its Manage Products checks). No-op if no user
-- had MANAGER. Cashier gets none, as before.
INSERT INTO `RolePermission` (`id`, `roleId`, `permission`)
SELECT REPLACE(UUID(), '-', ''), ro.`id`, p.`permission`
FROM `Role` ro
CROSS JOIN (
    SELECT 'Manage Warehouses' AS `permission`
    UNION ALL SELECT 'Manage Suppliers' AS `permission`
    UNION ALL SELECT 'Manage Customers' AS `permission`
    UNION ALL SELECT 'Manage Product Categories' AS `permission`
    UNION ALL SELECT 'Manage Products' AS `permission`
    UNION ALL SELECT 'Manage Brands' AS `permission`
    UNION ALL SELECT 'Manage Units' AS `permission`
    UNION ALL SELECT 'Manage Adjustments' AS `permission`
    UNION ALL SELECT 'Manage Purchase' AS `permission`
    UNION ALL SELECT 'Manage Purchase Return' AS `permission`
    UNION ALL SELECT 'Manage Sale' AS `permission`
    UNION ALL SELECT 'Manage Sale Return' AS `permission`
    UNION ALL SELECT 'Manage Transfers' AS `permission`
    UNION ALL SELECT 'Manage Expense Categories' AS `permission`
    UNION ALL SELECT 'Manage Expenses' AS `permission`
) AS p
WHERE ro.`name` = 'Manager';

-- Backfill every user's roleId from their old role value.
UPDATE `User` u
JOIN `Role` ro ON ro.`name` = CASE u.`role`
    WHEN 'ADMIN' THEN 'Administrator'
    WHEN 'MANAGER' THEN 'Manager'
    WHEN 'CASHIER' THEN 'Cashier'
END
SET u.`roleId` = ro.`id`;
