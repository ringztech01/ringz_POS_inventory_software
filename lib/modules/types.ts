import type { LucideIcon } from "lucide-react";
import type { BusinessSettings } from "@/lib/business-settings";

// What an optional module tells the app shell (lib/modules/registry.ts).
// Plain data: manifests are imported on the client too (sidebar, Role form),
// so no server code in them.

type PermissionMap = Readonly<Record<string, string>>;

// The BusinessSetting flags a module can be switched on with.
type BooleanSetting = {
  [K in keyof BusinessSettings]: BusinessSettings[K] extends boolean ? K : never;
}[keyof BusinessSettings];

// A link in the module's sidebar group (and its own header nav).
export type ModuleNavItem<P extends PermissionMap> = {
  label: string;
  href: string;
  // Any one of these shows the link. UX only — every page checks its own
  // permission.
  permissions: readonly P[keyof P][];
  // false: in the sidebar group only, not the module's header nav.
  header?: boolean;
};

export type ModuleManifest<P extends PermissionMap = PermissionMap> = {
  id: string;
  // The sidebar group, Role-form group and Settings row.
  label: string;
  description: string;
  icon: LucideIcon;
  // Key → permission string; merged into PERMISSIONS (lib/permissions.ts).
  permissions: P;
  nav: readonly ModuleNavItem<P>[];
  // The Settings page's switch: the flag it saves and who may change it.
  toggle: { setting: BooleanSetting; permission: P[keyof P] };
  isEnabled: (settings: BusinessSettings) => boolean;
};

// Type-checks a manifest, keeping its permission strings as literals.
export function defineModule<const P extends PermissionMap>(manifest: ModuleManifest<P>): ModuleManifest<P> {
  return manifest;
}
