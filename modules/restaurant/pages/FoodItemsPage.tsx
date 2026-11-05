import { RESTAURANT_PERMISSIONS } from "../manifest";
import { guardPage } from "../server/guard";
import { getMenuCategories, getMenuItemList } from "../server/queries/menuItems";
import { getStationOptions } from "../server/queries/stations";
import { getModifierGroupOptions } from "../server/queries/modifierList";
import MenuItemsPanel from "../components/food/MenuItemsPanel";

const PER_PAGE_OPTIONS = [10, 25, 50];

type Params = { q?: string; category?: string; page?: string; perPage?: string };

// /restaurant/food/items — Food › Menu items (RingzPOS Food Management
// design). Needs Manage Food.
export default async function FoodItemsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const denied = await guardPage(RESTAURANT_PERMISSIONS.MANAGE_FOOD);
  if (denied) return denied;

  const params = await searchParams;
  const q = params.q?.trim() || "";
  const page = Math.max(1, Math.floor(Number(params.page)) || 1);
  const perPage = PER_PAGE_OPTIONS.includes(Number(params.perPage)) ? Number(params.perPage) : 25;
  const [categories, stations, groups] = await Promise.all([getMenuCategories(), getStationOptions(), getModifierGroupOptions()]);
  // An unknown or deleted category in the URL means "All categories".
  const categoryId = categories.some((c) => c.id === params.category) ? params.category : undefined;
  const { rows, total } = await getMenuItemList({ q, categoryId, page, perPage });

  return (
    <MenuItemsPanel
      rows={rows}
      groups={groups}
      categories={categories.map((c) => ({ value: c.id, label: c.name }))}
      stations={stations}
      categoryId={categoryId ?? ""}
      filtered={!!q || !!categoryId}
      page={page}
      perPage={perPage}
      total={total}
      totalPages={Math.max(1, Math.ceil(total / perPage))}
    />
  );
}
