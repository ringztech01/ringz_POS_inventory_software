-- Restaurant Reports, Step 11: indexes for the reports' periods. Indexes
-- only; no data changes. (There's one business, so the spec's businessId
-- leads only where the table has the column; Order's period scope is its
-- status, training flag and closedAt; Kot has createdAt for "sentAt";
-- StaffShift is the Shift, startedAt its clock-in.)

-- CreateIndex
CREATE INDEX `Order_status_closedAt_idx` ON `Order`(`status`, `closedAt`);

-- CreateIndex
CREATE INDEX `Order_waiterId_closedAt_idx` ON `Order`(`waiterId`, `closedAt`);

-- CreateIndex
CREATE INDEX `Order_training_closedAt_idx` ON `Order`(`training`, `closedAt`);

-- CreateIndex
CREATE INDEX `OrderItem_orderId_productId_idx` ON `OrderItem`(`orderId`, `productId`);

-- CreateIndex
CREATE INDEX `OrderItem_cancelledAt_idx` ON `OrderItem`(`cancelledAt`);

-- CreateIndex
CREATE INDEX `Kot_orderId_createdAt_idx` ON `Kot`(`orderId`, `createdAt`);

-- CreateIndex
CREATE INDEX `WasteEntry_businessId_status_createdAt_idx` ON `WasteEntry`(`businessId`, `status`, `createdAt`);

-- CreateIndex
CREATE INDEX `StaffShift_userId_startedAt_idx` ON `StaffShift`(`userId`, `startedAt`);

-- CreateIndex
CREATE INDEX `DrawerEvent_businessId_createdAt_idx` ON `DrawerEvent`(`businessId`, `createdAt`);

-- CreateIndex
CREATE INDEX `DrawerEvent_deviceId_createdAt_idx` ON `DrawerEvent`(`deviceId`, `createdAt`);

-- CreateIndex
CREATE INDEX `SaleReturn_createdAt_idx` ON `SaleReturn`(`createdAt`);
