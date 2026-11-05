import { FONTS } from "@/components/layout/theme";
import { RESTAURANT_PERMISSIONS } from "../manifest";
import { guardPage } from "../server/guard";
import { getModifierGroupList, readGroupFilter } from "../server/queries/modifierGroups";
import { getModifierGroupOptions, getModifiersInGroup } from "../server/queries/modifierList";
import FoodTabs from "../components/food/FoodTabs";
import ModifierGroupsPanel from "../components/food/ModifierGroupsPanel";
import ModifierViews from "../components/food/ModifierViews";
import ModifiersPanel from "../components/food/ModifiersPanel";

const PER_PAGE_OPTIONS = [10, 25, 50];

type Params = { view?: string; group?: string; q?: string; required?: string; page?: string; perPage?: string };

// /restaurant/food/modifiers[?view=options&group=] — Food › Modifiers: the
// groups (first view) and the modifiers in one group (second; an unknown or
// missing group means the first). Needs Manage Food.
export default async function FoodModifiersPage({ searchParams }: { searchParams: Promise<Params> }) {
  const denied = await guardPage(RESTAURANT_PERMISSIONS.MANAGE_FOOD);
  if (denied) return denied;

  const params = await searchParams;
  const view = params.view === "options" ? "options" : "groups";

  let body;
  if (view === "groups") {
    const q = params.q?.trim() || "";
    const filter = readGroupFilter(params.required);
    const page = Math.max(1, Math.floor(Number(params.page)) || 1);
    const perPage = PER_PAGE_OPTIONS.includes(Number(params.perPage)) ? Number(params.perPage) : 25;
    const { rows, total } = await getModifierGroupList({ q, filter, page, perPage });
    body = (
      <ModifierGroupsPanel rows={rows} filter={filter} filtered={!!q || !!filter} page={page} perPage={perPage} total={total} totalPages={Math.max(1, Math.ceil(total / perPage))} />
    );
  } else {
    const groups = await getModifierGroupOptions();
    const groupId = groups.find((g) => g.id === params.group)?.id ?? groups[0]?.id ?? null;
    const rows = groupId ? await getModifiersInGroup(groupId) : [];
    body = <ModifiersPanel key={groupId ?? "none"} groups={groups} groupId={groupId} rows={rows} />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <h1 style={{ margin: 0, fontFamily: FONTS.display, fontSize: 24, fontWeight: 600 }}>Food</h1>
        <FoodTabs active="modifiers" />
      </div>
      <ModifierViews active={view} />
      {body}
    </div>
  );
}
