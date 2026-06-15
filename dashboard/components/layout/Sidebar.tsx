"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ClipboardCheck,
  FileText,
  HardDrive,
  Info,
  Key,
  LayoutDashboard,
  Settings,
  ShieldCheck,
  TriangleAlert,
  X,
} from "lucide-react";
import { getSidebarItems } from "@/lib/auth/rbac";
import type { Role } from "@/types/auth";
import { useSession } from "next-auth/react";
import type { ReactElement } from "react";

interface SidebarProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
}

interface SidebarItem {
  readonly label: string;
  readonly href: string;
  readonly icon: string;
}

const ICONS: Record<string, ReactElement> = {
  Dashboard: <LayoutDashboard className="h-5 w-5" aria-hidden="true" />,
  Devices: <HardDrive className="h-5 w-5" aria-hidden="true" />,
  Policies: <FileText className="h-5 w-5" aria-hidden="true" />,
  Violations: <TriangleAlert className="h-5 w-5" aria-hidden="true" />,
  Exceptions: <Key className="h-5 w-5" aria-hidden="true" />,
  Audit: <ClipboardCheck className="h-5 w-5" aria-hidden="true" />,
  Settings: <Settings className="h-5 w-5" aria-hidden="true" />,
};

const DEFAULT_ICON: ReactElement = (
  <Info className="h-5 w-5" aria-hidden="true" />
);

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const role = (session?.user?.role as Role) ?? "viewer";
  const items = getSidebarItems(role);

  return (
    <aside
      className={`
        fixed top-0 left-0 z-50 h-screen w-64 bg-vg-sidebar-bg border-r border-gray-700
        transform transition-transform duration-200 ease-in-out lg:translate-x-0
        ${isOpen ? "translate-x-0" : "-translate-x-full"}
      `}
      aria-label="Sidebar navigation"
    >
      <div className="flex flex-col h-full">
        {/* Logo */}
        <div className="flex items-center justify-between h-16 px-6 border-b border-gray-700">
          <Link href="/dashboard" className="flex items-center space-x-2" onClick={onClose}>
            <ShieldCheck className="h-8 w-8 text-vg-primary-500" aria-hidden="true" />
            <span className="text-xl font-bold text-white">VGuardrail</span>
          </Link>
          <button
            className="lg:hidden text-gray-400 hover:text-white"
            onClick={onClose}
            aria-label="Close sidebar"
          >
            <X className="h-6 w-6" aria-hidden="true" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1" role="navigation" aria-label="Main navigation">
          {items.map((item: SidebarItem) => {
            const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
            const Icon = ICONS[item.label] ?? DEFAULT_ICON;

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={`
                  flex items-center px-3 py-2.5 rounded-lg text-sm font-medium transition-colors
                  ${isActive
                    ? "bg-vg-primary-600 text-white"
                    : "text-vg-sidebar-text hover:bg-vg-sidebar-hover hover:text-white"}
                `}
                aria-current={isActive ? "page" : undefined}
              >
                <span className="flex-shrink-0 mr-3">{Icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Footer - Org info */}
        <div className="p-4 border-t border-gray-700">
          <div className="text-xs text-vg-sidebar-text">
            <p>Organization: <span className="text-white font-medium">{session?.user?.orgName ?? "Acme Corp"}</span></p>
            <p className="mt-1">Role: <span className="text-white font-medium capitalize">{role.replace("_", " ")}</span></p>
          </div>
        </div>
      </div>
    </aside>
  );
}
