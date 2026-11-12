-- The floor plan editor (Restaurant › Settings › Floor plan): each dining
-- area's room in metres, its tables' and fixtures' geometry, event layouts.
-- Table numbers become unique across the business among live tables, and
-- an area has at most one active event layout — both through a generated
-- column (NULL when not live / not active) with a unique index, as MySQL has
-- no partial indexes. The tables already there are placed in a tidy grid.

-- The room.
ALTER TABLE `DiningArea` ADD COLUMN `roomWidthM` DECIMAL(6, 2) NOT NULL DEFAULT 12,
    ADD COLUMN `roomHeightM` DECIMAL(6, 2) NOT NULL DEFAULT 8,
    ADD COLUMN `gridSizeM` DECIMAL(4, 2) NOT NULL DEFAULT 0.5,
    ADD COLUMN `backgroundImage` VARCHAR(191) NULL,
    ADD COLUMN `backgroundOpacity` DECIMAL(3, 2) NOT NULL DEFAULT 0.35,
    ADD COLUMN `backgroundScale` DECIMAL(10, 4) NULL,
    ADD COLUMN `backgroundOffset` JSON NULL,
    ADD COLUMN `layoutVersion` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `isLocked` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `prefix` VARCHAR(4) NULL;

-- The tables' geometry, and the live-name column behind the unique index.
ALTER TABLE `Table` ADD COLUMN `x` DECIMAL(6, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `y` DECIMAL(6, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `w` DECIMAL(6, 2) NOT NULL DEFAULT 1.4,
    ADD COLUMN `h` DECIMAL(6, 2) NOT NULL DEFAULT 1.4,
    ADD COLUMN `rotation` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `shape` ENUM('ROUND', 'SQUARE', 'RECT', 'BOOTH') NOT NULL DEFAULT 'SQUARE',
    ADD COLUMN `activeName` VARCHAR(191) GENERATED ALWAYS AS (IF(`deletedAt` IS NULL, `name`, NULL)) STORED;
CREATE UNIQUE INDEX `Table_activeName_key` ON `Table`(`activeName`);

-- Fixtures.
CREATE TABLE `FloorFixture` (
    `id` VARCHAR(191) NOT NULL,
    `areaId` VARCHAR(191) NOT NULL,
    `type` ENUM('BAR_COUNTER', 'KITCHEN_PASS', 'ENTRANCE', 'WALL', 'PILLAR', 'STAGE', 'WINDOW', 'LABEL') NOT NULL,
    `label` VARCHAR(40) NOT NULL,
    `x` DECIMAL(6, 2) NOT NULL,
    `y` DECIMAL(6, 2) NOT NULL,
    `w` DECIMAL(6, 2) NOT NULL,
    `h` DECIMAL(6, 2) NOT NULL,
    `rotation` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `FloorFixture_areaId_idx`(`areaId`),
    INDEX `FloorFixture_deletedAt_idx`(`deletedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Event layouts; activeAreaId is generated (one active layout per area).
CREATE TABLE `FloorLayout` (
    `id` VARCHAR(191) NOT NULL,
    `areaId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(60) NOT NULL,
    `snapshot` JSON NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT false,
    `activeAreaId` VARCHAR(191) GENERATED ALWAYS AS (IF(`isActive`, `areaId`, NULL)) STORED,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `FloorLayout_activeAreaId_key`(`activeAreaId`),
    INDEX `FloorLayout_areaId_idx`(`areaId`),
    INDEX `FloorLayout_createdById_idx`(`createdById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `FloorFixture` ADD CONSTRAINT `FloorFixture_areaId_fkey` FOREIGN KEY (`areaId`) REFERENCES `DiningArea`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `FloorLayout` ADD CONSTRAINT `FloorLayout_areaId_fkey` FOREIGN KEY (`areaId`) REFERENCES `DiningArea`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `FloorLayout` ADD CONSTRAINT `FloorLayout_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- The tables already there, in a tidy grid per area (lib/floorGeometry:
-- three to a row 3.8 m apart, rows 2.2 m apart, 0.4 m from the walls), each
-- shaped by its seats: up to 2 round, up to 4 square, more a long table.
UPDATE `Table` t
JOIN (
    SELECT `id`, ROW_NUMBER() OVER (PARTITION BY `areaId` ORDER BY `name`, `id`) - 1 AS n
    FROM `Table`
    WHERE `deletedAt` IS NULL
) g ON g.`id` = t.`id`
SET t.`shape` = CASE WHEN t.`seats` <= 2 THEN 'ROUND' WHEN t.`seats` <= 4 THEN 'SQUARE' ELSE 'RECT' END,
    t.`w` = CASE WHEN t.`seats` <= 2 THEN 1.2 WHEN t.`seats` <= 4 THEN 1.4 WHEN t.`seats` <= 6 THEN 2.6 ELSE 3.2 END,
    t.`h` = CASE WHEN t.`seats` <= 2 THEN 1.2 WHEN t.`seats` <= 4 THEN 1.4 WHEN t.`seats` <= 6 THEN 1.4 ELSE 1.6 END,
    t.`x` = 0.4 + MOD(g.n, 3) * 3.8,
    t.`y` = 0.4 + FLOOR(g.n / 3) * 2.2;

-- A room deep enough for its tables in that grid (at least 8 m).
UPDATE `DiningArea` a
JOIN (
    SELECT `areaId`, COUNT(*) AS c FROM `Table` WHERE `deletedAt` IS NULL GROUP BY `areaId`
) k ON k.`areaId` = a.`id`
SET a.`roomHeightM` = GREATEST(8, 0.4 + CEIL(k.c / 3) * 2.2);
