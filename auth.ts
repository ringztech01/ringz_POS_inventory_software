import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { credentialsSchema } from "@/lib/validations/auth";
import { redeemSwitchToken } from "@/lib/auth/posSwitch";
import { noteSignIn } from "@/lib/auth/signIns";
import { pinTerminalId } from "@/lib/auth/pinTerminal";
import { redeemRecoveryCode } from "@/lib/auth/recovery";
import { currentDeviceId } from "@/lib/hardware/device";

// This request's device (its long-lived cookie), or undefined where cookies
// can't be read: then the device isn't checked.
async function deviceNow(): Promise<string | null | undefined> {
  try {
    return await currentDeviceId();
  } catch {
    return undefined;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (rawCredentials) => {
        const parsed = credentialsSchema.safeParse(rawCredentials);
        if (!parsed.success) return null;

        const { email, password } = parsed.data;
        // A restaurant PIN terminal (Settings › Devices) takes PINs only.
        if (await pinTerminalId()) return null;

        // Disabled staff can't sign in; PIN-only staff (Settings › Staff,
        // Part 6f) have no usable email or password.
        const user = await prisma.user.findFirst({ where: { email, deletedAt: null } });
        if (!user || user.disabledAt || user.pinOnly) return null;

        const passwordsMatch = await bcrypt.compare(password, user.password);
        if (!passwordsMatch) return null;

        await noteSignIn(user.id, "password");
        return {
          id: user.id,
          email: user.email,
          name: `${user.firstName} ${user.lastName}`,
          image: user.image,
          role: user.role,
          sessionVersion: user.sessionVersion,
        };
      },
    }),
    // The restaurant touch POS's fast user switch: only a one-time token the
    // server minted after checking the waiter's PIN (lib/auth/posSwitch.ts).
    Credentials({
      id: "pos-switch",
      name: "POS switch",
      credentials: { token: { type: "text" } },
      authorize: async (rawCredentials) => {
        const userId = redeemSwitchToken(rawCredentials?.token);
        if (!userId) return null;
        const user = await prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
        if (!user || user.disabledAt) return null;
        await noteSignIn(user.id);
        return {
          id: user.id,
          email: user.email,
          name: `${user.firstName} ${user.lastName}`,
          image: user.image,
          role: user.role,
          sessionVersion: user.sessionVersion,
        };
      },
    }),
    // Emergency access (Part 6f Step 4): an Administrator's email and the
    // one-time recovery code from Settings › Staff — never on a PIN terminal.
    Credentials({
      id: "recovery",
      name: "Recovery code",
      credentials: { email: { type: "email" }, code: { type: "text" } },
      authorize: async (rawCredentials) => {
        if (await pinTerminalId()) return null;
        const user = await redeemRecoveryCode(rawCredentials?.email, rawCredentials?.code);
        if (!user) return null;
        await noteSignIn(user.id);
        return {
          id: user.id,
          email: user.email,
          name: `${user.firstName} ${user.lastName}`,
          image: user.image,
          role: user.role,
          sessionVersion: user.sessionVersion,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user?.id) {
        token.id = user.id;
        token.role = user.role;
        token.sv = user.sessionVersion ?? 0;
        // Part 6f Step 6: a session is this device's and this person's.
        token.did = (await deviceNow()) ?? null;
      }
      if (token.id) {
        // Every later look at the session (Part 6f): still allowed? A PIN
        // reset or disabling someone moves their sessionVersion on, which
        // ends this session on every device (returning null signs out).
        // A failed look-up (the database down for a moment) keeps the session:
        // every page and action checks the user again anyway.
        // The role's access level rides along (Part 6f Step 5): the proxy
        // keeps a Service-level user out of the back office with it.
        const now = await prisma.user
          .findUnique({
            where: { id: token.id },
            select: { sessionVersion: true, disabledAt: true, deletedAt: true, userRole: { select: { isSystem: true, accessLevel: true, deletedAt: true } } },
          })
          .catch((error: unknown) => {
            console.warn("[auth] couldn't check a session:", error);
            return undefined;
          });
        if (now === null || (now && (now.deletedAt || now.disabledAt || now.sessionVersion !== (token.sv ?? 0)))) return null;
        if (now) token.al = !now.userRole || now.userRole.deletedAt ? "SERVICE" : now.userRole.isSystem ? "BACK_OFFICE" : now.userRole.accessLevel;
        // Tied to the device it began on (Part 6f Step 6): the same session
        // cookie on another browser ends it. A session begun before the
        // browser had its device id takes the first one it's seen with.
        const device = await deviceNow();
        if (device !== undefined) {
          if (token.did && device !== token.did) return null;
          if (!token.did && device) token.did = device;
        }
      }

      // Triggered by useSession().update(...) — e.g. after a profile edit —
      // so open tabs pick up the new name/email/avatar without a re-login.
      if (trigger === "update" && session) {
        if (typeof session.name === "string") token.name = session.name;
        if (typeof session.email === "string") token.email = session.email;
        if (typeof session.image === "string") token.picture = session.image;
      }

      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id;
      session.user.role = token.role;
      session.user.accessLevel = token.al;
      return session;
    },
  },
});
