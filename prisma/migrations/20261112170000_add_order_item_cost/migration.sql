-- Restaurant Reports, Step 2: food cost. Settle now records what one of each
-- sold line cost (OrderItem.unitCost): what one takes from stock — the
-- recipe's ingredients, or the item itself — × each product's cost then.
-- Null when any of those has no cost.
--
-- Lines already settled are filled in once, the same way, from today's
-- recipes and costs (the costs at their settle weren't kept). Only sold
-- lines: billed orders with a Sale, not training; lines sent, not cancelled
-- or removed, not remakes. Nothing else changes.

-- AlterTable
ALTER TABLE `OrderItem` ADD COLUMN `unitCost` DECIMAL(14, 4) NULL;

-- Backfill
UPDATE `OrderItem` oi
  JOIN `Order` o ON o.`id` = oi.`orderId`
  JOIN `Product` p ON p.`id` = oi.`productId`
  LEFT JOIN (
    SELECT r.`menuItemId`,
           SUM(r.`quantity` * i.`cost`) AS `cost`,
           SUM(i.`cost` IS NULL) AS `missing`
    FROM `RecipeLine` r JOIN `Product` i ON i.`id` = r.`ingredientId`
    WHERE r.`deletedAt` IS NULL AND r.`quantity` > 0
    GROUP BY r.`menuItemId`
  ) rc ON rc.`menuItemId` = oi.`productId` AND p.`productType` = 'MENU_ITEM'
  SET oi.`unitCost` = CASE
    WHEN rc.`menuItemId` IS NULL THEN p.`cost`
    WHEN rc.`missing` > 0 THEN NULL
    ELSE ROUND(rc.`cost`, 4)
  END
  WHERE o.`status` = 'BILLED' AND o.`saleId` IS NOT NULL AND o.`training` = 0
    AND oi.`cancelledAt` IS NULL AND oi.`deletedAt` IS NULL AND oi.`kitchenStatus` <> 'NEW' AND oi.`remakeOfId` IS NULL
    AND oi.`unitCost` IS NULL;
