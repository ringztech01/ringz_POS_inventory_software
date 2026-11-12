"use client";

import { useState } from "react";
import ScanProvider, { useScan } from "@/components/hardware/ScanProvider";
import type { PosStaff } from "../../server/queries/posScreen";
import { signInByPin } from "../../server/actions/pinSignIn";
import { startMyShift } from "../../server/actions/session";
import PinSwitch, { PinWelcome } from "./PinSwitch";
import ShiftPrompt from "./ShiftPrompt";

const UNREACHABLE = "Couldn't reach the server. Check the connection and try again.";

// The sign-in page of a restaurant PIN terminal (Part 6f Step 4; the PIN
// Login design): no email, no password, no sidebar. The 4th digit signs in
// (a name tapped first is optional), a welcome for a moment, then the
// person's home screen — a full page load, so every screen sees the new
// session. Wrong PINs lock this device for a while; the pad counts down.
// With clock in / out on (Step 6), someone not on shift is asked "Start
// shift?" first. `clockOn`: the list is who's on shift.
// `kind` (Step 7c): the Kitchen screen or a Bar terminal says so at the top.
// A staff card held to the reader (Step 7d) signs in like the PIN.
type Props = { staff: PosStaff[]; hideNames: boolean; clockOn?: boolean; kind?: "POS" | "KITCHEN" | "BAR"; cards?: boolean };

export default function PinLogin(props: Props) {
  return (
    <ScanProvider>
      <PinLoginScreen {...props} />
    </ScanProvider>
  );
}

function PinLoginScreen({ staff, hideNames, clockOn = false, kind = "POS", cards = false }: Props) {
  const [welcome, setWelcome] = useState<{ name: string; initials: string } | null>(null);
  const [heldUntil, setHeldUntil] = useState<number | null>(null);
  const [askShift, setAskShift] = useState<{ home: string } | null>(null);
  const [starting, setStarting] = useState(false);
  const [notice, setNotice] = useState<{ text: string } | null>(null);
  const [reading, setReading] = useState(false);

  const goHome = (home: string) => window.location.replace(home);

  const submit = (userId: string | null, pin: string) => signIn({ userId, pin });

  async function signIn(input: { userId: string | null; pin: string } | { card: string }): Promise<string | null> {
    const result = await signInByPin(input).catch(() => ({ ok: false as const, error: UNREACHABLE, waitSeconds: undefined }));
    if (!result.ok) {
      if (result.waitSeconds) setHeldUntil(Date.now() + result.waitSeconds * 1000);
      return result.error;
    }
    setHeldUntil(null);
    setWelcome({ name: result.name, initials: result.initials });
    window.setTimeout(() => {
      if (result.askShift) {
        setWelcome(null);
        setAskShift({ home: result.home });
      } else goHome(result.home);
    }, 900);
    return null;
  }

  // A card: the same as a PIN, its answer shown on the pad.
  useScan((code) => {
    if (reading || welcome || askShift) return;
    setReading(true);
    void signIn({ card: code }).then((problem) => {
      setReading(false);
      if (problem) setNotice({ text: problem });
    });
  });

  async function startShift(home: string) {
    setStarting(true);
    const result = await startMyShift().catch(() => ({ ok: false as const, error: UNREACHABLE }));
    setStarting(false);
    // Signed in either way: a failure here doesn't keep them off the till.
    if (!result.ok) window.alert(result.error);
    goHome(home);
  }

  return (
    <>
      <PinSwitch
        signIn
        badge={kind === "KITCHEN" ? "KITCHEN SCREEN" : kind === "BAR" ? "BAR TERMINAL" : "RESTAURANT"}
        cards={cards}
        notice={notice}
        staff={staff}
        withoutPin={0}
        locked
        hideNames={hideNames}
        heldUntil={heldUntil}
        currentUserId=""
        emptyText={
          kind === "KITCHEN"
            ? "Kitchen staff and managers: type your PIN."
            : clockOn
              ? "Nobody's on shift yet. Type your PIN to sign in and start yours."
              : "Nobody has a PIN yet. An Administrator adds staff and sets their PINs on Settings › Staff."
        }
        onSubmit={submit}
        onClose={() => undefined}
      />
      {welcome && <PinWelcome name={welcome.name} initials={welcome.initials} note={null} />}
      {askShift && (
        <ShiftPrompt
          title="Start your shift?"
          detail="Clocks you in now. Your hours and sales count from here."
          busy={starting}
          choices={[
            { label: "Start shift", data: "start", onPick: () => void startShift(askShift.home) },
            { label: "Not now", data: "later", tone: "plain", onPick: () => goHome(askShift.home) },
          ]}
        />
      )}
    </>
  );
}
