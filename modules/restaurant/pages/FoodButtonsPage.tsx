import { FONTS } from "@/components/layout/theme";
import { RESTAURANT_PERMISSIONS } from "../manifest";
import { guardPage } from "../server/guard";
import { getButtonEditor } from "../server/queries/menuGroups";
import FoodTabs from "../components/food/FoodTabs";
import ButtonLayoutEditor from "../components/food/ButtonLayoutEditor";
import QuickNotesPanel from "../components/food/QuickNotesPanel";

// /restaurant/food/buttons — Food › POS buttons: the touch POS's groups,
// sub-groups and where every button sits, and the Note keypad's quick notes.
// Needs Manage Food.
export default async function FoodButtonsPage() {
  const denied = await guardPage(RESTAURANT_PERMISSIONS.MANAGE_FOOD);
  if (denied) return denied;

  const data = await getButtonEditor();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <h1 style={{ margin: 0, fontFamily: FONTS.display, fontSize: 24, fontWeight: 600 }}>Food</h1>
        <FoodTabs active="buttons" />
      </div>
      <ButtonLayoutEditor data={data} />
      <QuickNotesPanel notes={data.quickNotes} />
    </div>
  );
}
