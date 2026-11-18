-- Restaurant Part 8, Step 6: service requests. A guest's Call waiter or
-- Request bill from the table's menu, shown as a bell on the floor screens
-- until a waiter acknowledges it and then marks it done.

-- CreateTable
CREATE TABLE `TableRequest` (
    `id` VARCHAR(191) NOT NULL,
    `tableId` VARCHAR(191) NOT NULL,
    `type` ENUM('CALL_WAITER', 'REQUEST_BILL') NOT NULL,
    `status` ENUM('OPEN', 'ACKNOWLEDGED', 'DONE') NOT NULL DEFAULT 'OPEN',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `ackById` VARCHAR(191) NULL,
    `ackAt` DATETIME(3) NULL,
    `doneAt` DATETIME(3) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `TableRequest_tableId_status_idx`(`tableId`, `status`),
    INDEX `TableRequest_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `TableRequest_ackById_idx`(`ackById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `TableRequest` ADD CONSTRAINT `TableRequest_tableId_fkey` FOREIGN KEY (`tableId`) REFERENCES `Table`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TableRequest` ADD CONSTRAINT `TableRequest_ackById_fkey` FOREIGN KEY (`ackById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
