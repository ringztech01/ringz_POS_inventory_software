"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Search, ChevronRight } from "lucide-react";
import { useSidebar } from "./sidebar-context";
import { NAV, type NavItem, type NavChild, isPathActive } from "./nav-data";
import { useToggleState } from "./hooks";
import { COLORS, FONTS } from "./theme";

function NavChildRow({ child, pathname }: { child: NavChild; pathname: string }) {
  const hover = useToggleState();
  const active = isPathActive(pathname, child.href);

  return (
    <Link
      href={child.href}
      onMouseEnter={hover.on}
      onMouseLeave={hover.off}
      style={{
        width: "100%",
        textAlign: "left",
        height: 34,
        padding: "0 10px",
        borderRadius: 6,
        background: active ? COLORS.tealTint : hover.value ? COLORS.bgApp : "transparent",
        color: active ? COLORS.tealDark : COLORS.slate,
        fontSize: 13,
        fontWeight: active ? 600 : 400,
        cursor: "pointer",
        whiteSpace: "nowrap",
        display: "flex",
        alignItems: "center",
        textDecoration: "none",
      }}
    >
      {child.label}
    </Link>
  );
}

function NavRow({ item, expanded }: { item: NavItem; expanded: boolean }) {
  const pathname = usePathname() || "";
  const { openGroup, toggleGroup } = useSidebar();
  const hover = useToggleState();
  const Icon = item.icon;

  const hasChildren = !!item.children?.length;
  const isOpen = expanded && openGroup === item.key;
  const isActive = hasChildren
    ? item.children!.some((c) => isPathActive(pathname, c.href))
    : !!item.href && isPathActive(pathname, item.href);

  const background = isActive && !isOpen ? COLORS.tealTint : isOpen ? COLORS.bgApp : hover.value ? COLORS.bgApp : "transparent";
  const color = isActive ? COLORS.tealDark : COLORS.slate;
  const fontWeight = isActive ? 600 : 500;

  const buttonStyle: React.CSSProperties = {
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: 12,
    height: 40,
    padding: "0 12px",
    border: "none",
    borderRadius: 8,
    background,
    color,
    fontSize: 13.5,
    fontWeight,
    cursor: "pointer",
    textAlign: "left",
    transition: "background .12s",
    textDecoration: "none",
  };

  const content = (
    <>
      <span
        style={{
          flex: "0 0 auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 18,
          height: 18,
        }}
      >
        <Icon size={17} strokeWidth={1.6} />
      </span>
      {expanded && (
        <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {item.label}
        </span>
      )}
      {expanded && hasChildren && (
        <ChevronRight
          size={13}
          strokeWidth={1.8}
          style={{
            flex: "0 0 auto",
            transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
            transition: "transform .16s",
          }}
        />
      )}
    </>
  );

  return (
    <div>
      {hasChildren ? (
        <button
          type="button"
          title={item.label}
          onClick={() => toggleGroup(item.key)}
          onMouseEnter={hover.on}
          onMouseLeave={hover.off}
          style={buttonStyle}
        >
          {content}
        </button>
      ) : (
        <Link href={item.href!} title={item.label} onMouseEnter={hover.on} onMouseLeave={hover.off} style={buttonStyle}>
          {content}
        </Link>
      )}

      {expanded && hasChildren && isOpen && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 2,
            margin: "2px 0 6px 15px",
            paddingLeft: 13,
            borderLeft: `1px solid ${COLORS.border}`,
          }}
        >
          {item.children!.map((child) => (
            <NavChildRow key={child.href} child={child} pathname={pathname} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function Sidebar() {
  const { collapsed } = useSidebar();
  const expanded = !collapsed;
  const search = useToggleState();

  return (
    <aside
      style={{
        width: collapsed ? 72 : 248,
        flex: "0 0 auto",
        background: "#fff",
        borderRight: `1px solid ${COLORS.border}`,
        display: "flex",
        flexDirection: "column",
        position: "sticky",
        top: 0,
        height: "100vh",
        transition: "width .18s ease",
      }}
    >
      <div
        style={{
          height: 60,
          flex: "0 0 auto",
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "0 16px",
          borderBottom: `1px solid ${COLORS.border}`,
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            flex: "0 0 auto",
            borderRadius: 9,
            background: COLORS.teal,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            fontFamily: FONTS.display,
            fontWeight: 700,
            fontSize: 16,
          }}
        >
          R
        </div>
        {expanded && (
          <span style={{ fontFamily: FONTS.display, fontSize: 17, fontWeight: 700, letterSpacing: "-.01em", whiteSpace: "nowrap" }}>
            RingzPOS
          </span>
        )}
      </div>

      {expanded && (
        <div style={{ padding: "14px 12px 6px", flex: "0 0 auto" }}>
          <div style={{ position: "relative" }}>
            <Search size={14} strokeWidth={1.6} color={COLORS.slateMid} style={{ position: "absolute", left: 11, top: 11 }} />
            <input
              placeholder="Search"
              onFocus={search.on}
              onBlur={search.off}
              style={{
                width: "100%",
                height: 36,
                border: `1px solid ${search.value ? COLORS.teal : COLORS.borderStrong}`,
                borderRadius: 8,
                padding: "0 10px 0 32px",
                fontSize: 13,
                outline: "none",
                background: search.value ? "#fff" : COLORS.bgInput,
                boxShadow: search.value ? `0 0 0 3px ${COLORS.focusRing}` : "none",
              }}
            />
          </div>
        </div>
      )}

      <nav style={{ flex: 1, overflowY: "auto", padding: "6px 12px 20px", display: "flex", flexDirection: "column", gap: 2 }}>
        {NAV.map((item) => (
          <NavRow key={item.key} item={item} expanded={expanded} />
        ))}
      </nav>
    </aside>
  );
}
