import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import LoginForm from "@/components/auth/LoginForm";
import { pinTerminalId } from "@/lib/auth/pinTerminal";
import { isModuleEnabled } from "@/lib/modules/enabled.server";
import PinLoginPage from "@/modules/restaurant/pages/PinLoginPage";
import { getServiceRoutes } from "@/modules/restaurant/server/serviceView";
import { signedInLanding } from "@/modules/restaurant/server/services/pinSignIn";

export const metadata: Metadata = {
  title: "Sign in · RingzPOS",
};

// The sign-in page. On a restaurant PIN terminal (Settings › Devices, Part
// 6f Step 4) it's the PIN screen — no email or password there. Signed in
// already: the dashboard, or with the Restaurant module on, the home screen
// of someone on a terminal or with a Service-level role.
export default async function LoginPage() {
  const [session, terminal] = await Promise.all([auth(), pinTerminalId()]);

  if (session?.user?.id) {
    const landing = (await isModuleEnabled("restaurant").catch(() => false))
      ? await getServiceRoutes()
          .then((routes) => signedInLanding(session.user.id, terminal, routes))
          .catch((error: unknown) => {
            console.warn("[auth] couldn't find a home screen:", error);
            return null;
          })
      : null;
    redirect(landing ?? "/dashboard");
  }

  if (terminal) return <PinLoginPage />;
  return <LoginForm recovery={await isModuleEnabled("restaurant").catch(() => false)} />;
}
