import type { DefaultSession } from "next-auth";
import type { AccessLevel, UserRole } from "@prisma/client";

declare module "next-auth" {
  interface User {
    role: UserRole;
    // Part 6f: the user's sessionVersion when this session began.
    sessionVersion?: number;
  }

  interface Session {
    user: {
      id: string;
      role: UserRole;
      // Part 6f Step 5: the role's access level (the proxy's back-office guard).
      accessLevel?: AccessLevel;
    } & DefaultSession["user"];
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    id: string;
    role: UserRole;
    // Part 6f: the user's sessionVersion when this session began — a PIN
    // reset or disabling them moves it on, which ends the session.
    sv?: number;
    // The role's access level, read again on each look at the session.
    al?: AccessLevel;
    // Part 6f Step 6: the device (its cookie id) the session belongs to.
    did?: string | null;
  }
}
