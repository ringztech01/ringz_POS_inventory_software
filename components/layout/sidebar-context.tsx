"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

type SidebarContextValue = {
  collapsed: boolean;
  toggleCollapsed: () => void;
  openGroup: string | null;
  toggleGroup: (key: string) => void;
};

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  const toggleCollapsed = () => {
    setCollapsed((c) => !c);
    setOpenGroup(null);
  };

  const toggleGroup = (key: string) => {
    setOpenGroup((current) => (current === key ? null : key));
  };

  return (
    <SidebarContext.Provider value={{ collapsed, toggleCollapsed, openGroup, toggleGroup }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error("useSidebar must be used within a SidebarProvider");
  return ctx;
}
