"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";

const ROUTE_LABELS: Readonly<Record<string, string>> = {
  dashboard: "Dashboard",
  devices: "Devices",
  policies: "Policies",
  violations: "Violations",
  exceptions: "Exceptions",
  audit: "Audit",
  settings: "Settings",
};

function formatSegment(segment: string): string {
  // Remove dynamic route brackets and format
  const clean = segment.replace(/\[|\]/g, "");
  return ROUTE_LABELS[clean] ?? clean.charAt(0).toUpperCase() + clean.slice(1);
}

interface BreadcrumbItem {
  readonly label: string;
  readonly href: string;
  readonly isLast: boolean;
}

function buildBreadcrumbItems(pathname: string): BreadcrumbItem[] {
  const segments = pathname.split("/").filter(Boolean);
  
  if (segments.length === 0) {
    return [];
  }

  // The home crumb is skipped on /dashboard itself, where the first segment
  // already produces it (a duplicate href would collide as a React key).
  const items: BreadcrumbItem[] =
    segments[0] === "dashboard"
      ? []
      : [{ label: "Dashboard", href: "/dashboard", isLast: false }];

  segments.forEach((segment, index) => {
    const isLast = index === segments.length - 1;
    const href = "/" + segments.slice(0, index + 1).join("/");
    const label = formatSegment(segment);
    items.push({ label, href, isLast });
  });

  return items;
}

export function Breadcrumbs(): JSX.Element | null {
  const pathname = usePathname();
  const items = buildBreadcrumbItems(pathname);

  if (items.length === 0) return null;

  return (
    <nav className="flex items-center space-x-2 text-sm" aria-label="Breadcrumb">
      <ol className="flex items-center space-x-2">
        {items.map((item, index) => (
          <li key={item.href} className="flex items-center">
            {index > 0 && (
              <svg
                className="h-4 w-4 text-gray-400 mx-2"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            )}
            {item.isLast ? (
              <span className="text-gray-900 dark:text-white font-medium" aria-current="page">
                {item.label}
              </span>
            ) : (
              <Link
                href={item.href}
                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
                {item.label}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
