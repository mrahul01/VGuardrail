"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  CircleQuestionMark,
  LogOut,
  Menu,
  Settings,
} from "lucide-react";
import { GlobalSearch } from "@/components/layout/GlobalSearch";
import { NotificationsBell } from "@/components/layout/NotificationsBell";
import { Dropdown, type DropdownItem } from "@/components/ui/Dropdown";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import type { Role } from "@/types/auth";
import type { ReactNode } from "react";

export interface TopbarProps {
  readonly onMenuClick: () => void;
  readonly children?: ReactNode;
}

export function Topbar({ onMenuClick }: TopbarProps) {
  const { data: session } = useSession();
  const router = useRouter();
  const role = (session?.user?.role as Role) ?? "viewer";

  const handleSignOut = (): void => {
    // Use the custom Cognito logout route (clears cookies + Hosted-UI logout).
    // NextAuth's signOut() would POST to /api/auth/signout, which this app
    // (custom auth routes, not [...nextauth]) does not implement.
    window.location.href = "/api/auth/logout";
  };

  const userMenuItems: readonly DropdownItem[] = [
    {
      label: "Settings",
      icon: <Settings className="h-4 w-4" aria-hidden="true" />,
      onClick: () => router.push("/settings"),
    },
    {
      label: "Help & Support",
      icon: <CircleQuestionMark className="h-4 w-4" aria-hidden="true" />,
      onClick: () => router.push("/help"),
    },
    { label: "", onClick: () => undefined, divider: true },
    {
      label: "Sign Out",
      icon: <LogOut className="h-4 w-4" aria-hidden="true" />,
      danger: true,
      onClick: handleSignOut,
    },
  ];

  return (
    <header className="sticky top-0 z-30 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between h-16 px-4 lg:px-8">
        {/* Left: Menu button + Search */}
        <div className="flex items-center space-x-4">
          <button
            type="button"
            className="lg:hidden p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-200"
            onClick={onMenuClick}
            aria-label="Open menu"
          >
            <Menu className="h-6 w-6" aria-hidden="true" />
          </button>

          {/* Global Search */}
          <GlobalSearch />
        </div>

        {/* Right: Theme toggle, Notifications, User menu */}
        <div className="flex items-center space-x-4">
          {/* Theme toggle */}
          <ThemeToggle />

          {/* Notifications */}
          <NotificationsBell />

          {/* User Menu */}
          <Dropdown
            align="right"
            items={userMenuItems}
            header={
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-white">
                  {session?.user?.email ?? "User"}
                </p>
                <p className="text-xs text-gray-500 capitalize">
                  {role.replace("_", " ")}
                </p>
              </div>
            }
            trigger={
              <button
                type="button"
                className="flex items-center space-x-2 p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
                aria-label="User menu"
              >
                <div className="h-8 w-8 rounded-full bg-vg-primary-100 dark:bg-vg-primary-900 flex items-center justify-center">
                  <span className="text-sm font-medium text-vg-primary-700 dark:text-vg-primary-300">
                    {session?.user?.email?.charAt(0).toUpperCase() ?? "U"}
                  </span>
                </div>
                <span className="hidden md:block text-sm font-medium text-gray-700 dark:text-gray-200">
                  {session?.user?.email ?? "User"}
                </span>
                <ChevronDown
                  className="h-4 w-4 text-gray-500"
                  aria-hidden="true"
                />
              </button>
            }
          />
        </div>
      </div>
    </header>
  );
}
