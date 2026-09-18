"use client";

import { useEffect, useRef, type ReactNode, type CSSProperties } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { Menu, Search, Plus, Maximize, ChevronDown, User as UserIcon, KeyRound, LogOut, type LucideIcon } from "lucide-react";
import { useSidebar } from "./sidebar-context";
import { useToggleState } from "./hooks";
import { resolveBreadcrumb } from "./nav-data";
import { COLORS, FONTS } from "./theme";

function IconButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  const hover = useToggleState();
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      onMouseEnter={hover.on}
      onMouseLeave={hover.off}
      style={{
        width: 38,
        height: 38,
        flex: "0 0 auto",
        border: `1px solid ${COLORS.borderStrong}`,
        background: "#fff",
        borderRadius: 8,
        cursor: "pointer",
        color: hover.value ? COLORS.ink : COLORS.slate,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {children}
    </button>
  );
}

function UserMenuItem({
  icon: Icon,
  label,
  href,
  onClick,
  danger,
}: {
  icon: LucideIcon;
  label: string;
  href?: string;
  onClick?: () => void;
  danger?: boolean;
}) {
  const hover = useToggleState();
  const style: CSSProperties = {
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: 8,
    textAlign: "left",
    background: hover.value ? (danger ? COLORS.dangerBg : COLORS.bgApp) : "transparent",
    border: "none",
    padding: "9px 10px",
    borderRadius: 6,
    fontSize: 13.5,
    color: danger ? COLORS.danger : COLORS.text,
    cursor: "pointer",
    textDecoration: "none",
  };

  const content = (
    <>
      <Icon size={15} strokeWidth={1.7} />
      {label}
    </>
  );

  if (href) {
    return (
      <Link href={href} onClick={onClick} onMouseEnter={hover.on} onMouseLeave={hover.off} style={style}>
        {content}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} onMouseEnter={hover.on} onMouseLeave={hover.off} style={style}>
      {content}
    </button>
  );
}

export default function Topbar() {
  const pathname = usePathname() || "/dashboard";
  const { toggleCollapsed } = useSidebar();
  const { data: session } = useSession();
  const { value: userMenuOpen, on: openUserMenu, off: closeUserMenu } = useToggleState();
  const newHover = useToggleState();
  const posHover = useToggleState();
  const searchFocus = useToggleState();
  const userMenuRef = useRef<HTMLDivElement>(null);
  const { section, title } = resolveBreadcrumb(pathname);

  const displayName = session?.user?.name?.trim() || session?.user?.email || "User";
  const avatarInitial = displayName.charAt(0).toUpperCase();

  useEffect(() => {
    if (!userMenuOpen) return;

    function handlePointerDown(event: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        closeUserMenu();
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeUserMenu();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [userMenuOpen, closeUserMenu]);

  const headerActionsStyle: CSSProperties = {
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: 10,
  };

  return (
    <header
      style={{
        height: 60,
        flex: "0 0 auto",
        background: "#fff",
        borderBottom: `1px solid ${COLORS.border}`,
        display: "flex",
        alignItems: "center",
        gap: 20,
        padding: "0 24px",
        boxShadow: "0 2px 8px -1px rgba(23,27,28,.06)",
        position: "sticky",
        top: 0,
        zIndex: 40,
      }}
    >
      <IconButton title="Collapse menu" onClick={toggleCollapsed}>
        <Menu size={16} strokeWidth={1.7} />
      </IconButton>

      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        <span style={{ fontFamily: FONTS.mono, fontSize: 11.5, color: COLORS.slateLight }}>{section} /</span>
        <span style={{ fontSize: 14.5, fontWeight: 600, whiteSpace: "nowrap" }}>{title}</span>
      </div>

      <div style={{ position: "relative", flex: 1, maxWidth: 420 }}>
        <Search size={15} strokeWidth={1.6} color={COLORS.slateMid} style={{ position: "absolute", left: 12, top: 11 }} />
        <input
          placeholder="Search anything — products, references, customers"
          onFocus={searchFocus.on}
          onBlur={searchFocus.off}
          style={{
            width: "100%",
            height: 38,
            border: `1px solid ${searchFocus.value ? COLORS.teal : COLORS.borderStrong}`,
            borderRadius: 8,
            padding: "0 12px 0 34px",
            fontSize: 13.5,
            outline: "none",
            background: searchFocus.value ? "#fff" : COLORS.bgInput,
            boxShadow: searchFocus.value ? `0 0 0 3px ${COLORS.focusRing}` : "none",
          }}
        />
      </div>

      <div style={headerActionsStyle}>
        <button
          type="button"
          onMouseEnter={newHover.on}
          onMouseLeave={newHover.off}
          style={{
            height: 38,
            padding: "0 14px",
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: newHover.value ? COLORS.tealDark : COLORS.teal,
            border: "none",
            borderRadius: 8,
            fontSize: 13.5,
            fontWeight: 600,
            color: "#fff",
            cursor: "pointer",
          }}
        >
          <Plus size={14} strokeWidth={1.9} />
          New
        </button>

        <button
          type="button"
          onMouseEnter={posHover.on}
          onMouseLeave={posHover.off}
          style={{
            height: 38,
            padding: "0 14px",
            background: posHover.value ? COLORS.tealTint : "#fff",
            border: `1px solid ${posHover.value ? COLORS.tealBorder : COLORS.borderStrong}`,
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: ".04em",
            color: COLORS.tealDark,
            cursor: "pointer",
          }}
        >
          POS
        </button>

        <IconButton title="Fullscreen">
          <Maximize size={16} strokeWidth={1.6} />
        </IconButton>

        <div style={{ width: 1, height: 26, background: COLORS.border }} />

        <div ref={userMenuRef}>
          <button
            type="button"
            onClick={userMenuOpen ? closeUserMenu : openUserMenu}
            style={{
              height: 38,
              padding: "4px 10px 4px 4px",
              display: "flex",
              alignItems: "center",
              gap: 9,
              background: userMenuOpen ? COLORS.bgApp : "transparent",
              border: `1px solid ${userMenuOpen ? COLORS.border : "transparent"}`,
              borderRadius: 8,
              cursor: "pointer",
            }}
          >
            <span
              style={{
                width: 30,
                height: 30,
                borderRadius: 999,
                background: COLORS.avatar,
                color: "#fff",
                fontFamily: FONTS.display,
                fontWeight: 600,
                fontSize: 13,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {avatarInitial}
            </span>
            <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", lineHeight: 1.2 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{displayName}</span>
              <span style={{ fontSize: 11, color: COLORS.slateMid }}>Administrator</span>
            </span>
            <ChevronDown size={13} strokeWidth={1.8} color={COLORS.slateMid} />
          </button>

          {userMenuOpen && (
            <div
              style={{
                position: "absolute",
                right: 24,
                top: 54,
                width: 206,
                background: "#fff",
                border: `1px solid ${COLORS.border}`,
                borderRadius: 10,
                boxShadow: "0 8px 24px -6px rgba(23,27,28,.20)",
                padding: 6,
                zIndex: 50,
                animation: "elv-pop .12s ease-out",
              }}
            >
              <UserMenuItem icon={UserIcon} label="Profile" href="/profile" onClick={closeUserMenu} />
              <UserMenuItem icon={KeyRound} label="Change Password" href="/change-password" onClick={closeUserMenu} />
              <div style={{ height: 1, background: COLORS.border, margin: "5px 6px" }} />
              <UserMenuItem
                icon={LogOut}
                label="Logout"
                danger
                onClick={() => {
                  closeUserMenu();
                  signOut({ callbackUrl: "/" });
                }}
              />
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
