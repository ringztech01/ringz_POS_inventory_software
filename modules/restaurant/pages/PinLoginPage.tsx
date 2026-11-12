import { pinTerminalId } from "@/lib/auth/pinTerminal";
import { getPinLoginScreen, type PinLoginScreen } from "../server/services/pinSignIn";
import PinLogin from "../components/pos/PinLogin";

// The sign-in page on a restaurant PIN terminal (Part 6f Step 4) — app/page
// shows it instead of the email sign-in. If the on-shift list can't be read,
// the pad still works (a PIN alone signs in).
export default async function PinLoginPage() {
  const screen: PinLoginScreen = await getPinLoginScreen(await pinTerminalId()).catch((error: unknown) => {
    console.error("[restaurant] PIN screen's staff list failed:", error);
    return { staff: [], hideNames: true, clockOn: false, kind: "POS" as const, cards: false };
  });
  return <PinLogin staff={screen.staff} hideNames={screen.hideNames} clockOn={screen.clockOn} kind={screen.kind} cards={screen.cards} />;
}
