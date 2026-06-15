"use client";

import {
  ButtonHTMLAttributes,
  HTMLAttributes,
  ReactNode,
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useId,
  useMemo,
  useState,
} from "react";
import { cn } from "@/lib/utils/cn";

export interface TabItem {
  readonly id: string;
  readonly label: string;
  readonly content: ReactNode;
  readonly disabled?: boolean;
}

export interface TabsProps extends Omit<HTMLAttributes<HTMLDivElement>, "onChange"> {
  readonly items: readonly TabItem[];
  readonly defaultActiveId?: string;
  readonly activeId?: string;
  readonly onValueChange?: (id: string) => void;
  readonly variant?: "default" | "pills" | "underline";
}

interface TabsContextValue {
  readonly activeId: string;
  readonly setActiveId: (id: string) => void;
  readonly variant: NonNullable<TabsProps["variant"]>;
  readonly baseId: string;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext(component: string): TabsContextValue {
  const ctx = useContext(TabsContext);
  if (!ctx) {
    throw new Error(`<${component}> must be used within <Tabs>.`);
  }
  return ctx;
}

const tabListVariantStyles: Record<
  NonNullable<TabsProps["variant"]>,
  string
> = {
  default:
    "border-b border-gray-200 dark:border-gray-700 gap-1",
  pills: "gap-2",
  underline: "border-b border-gray-200 dark:border-gray-700 gap-4",
};

const tabTriggerVariantStyles: Record<
  NonNullable<TabsProps["variant"]>,
  { base: string; active: string; inactive: string }
> = {
  default: {
    base: "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
    active:
      "border-vg-primary-600 text-vg-primary-700 dark:text-vg-primary-400",
    inactive:
      "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-200",
  },
  pills: {
    base: "px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
    active:
      "bg-vg-primary-100 text-vg-primary-700 dark:bg-vg-primary-900/30 dark:text-vg-primary-300",
    inactive:
      "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800",
  },
  underline: {
    base: "px-2 py-3 text-sm font-medium border-b-2 -mb-px transition-colors",
    active:
      "border-vg-primary-600 text-vg-primary-700 dark:text-vg-primary-400",
    inactive:
      "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200",
  },
};

export const Tabs = forwardRef<HTMLDivElement, TabsProps>(
  (
    {
      className,
      items,
      defaultActiveId,
      activeId: controlledActiveId,
      onValueChange,
      variant = "default",
      children,
      ...props
    },
    ref
  ) => {
    const baseId = useId();
    const isControlled = controlledActiveId !== undefined;
    const firstEnabled = useMemo(
      () => items.find((item) => !item.disabled)?.id ?? "",
      [items]
    );
    const [internalActiveId, setInternalActiveId] = useState<string>(
      defaultActiveId ?? firstEnabled
    );
    const activeId = isControlled ? controlledActiveId : internalActiveId;

    const setActiveId = useCallback(
      (id: string): void => {
        if (!isControlled) setInternalActiveId(id);
        onValueChange?.(id);
      },
      [isControlled, onValueChange]
    );

    const ctx = useMemo<TabsContextValue>(
      () => ({ activeId, setActiveId, variant, baseId }),
      [activeId, setActiveId, variant, baseId]
    );

    const activeItem = items.find((item) => item.id === activeId);

    return (
      <TabsContext.Provider value={ctx}>
        <div ref={ref} className={cn("w-full", className)} {...props}>
          {children ?? (
            <>
              <TabsList>
                {items.map((item) => (
                  <TabsTrigger
                    key={item.id}
                    id={item.id}
                    disabled={item.disabled ?? false}
                  >
                    {item.label}
                  </TabsTrigger>
                ))}
              </TabsList>
              {activeItem && (
                <TabsPanel id={activeItem.id}>{activeItem.content}</TabsPanel>
              )}
            </>
          )}
        </div>
      </TabsContext.Provider>
    );
  }
);

Tabs.displayName = "Tabs";

export type TabsListProps = HTMLAttributes<HTMLDivElement>;

export const TabsList = forwardRef<HTMLDivElement, TabsListProps>(
  ({ className, children, role = "tablist", ...props }, ref) => {
    const { variant } = useTabsContext("TabsList");
    return (
      <div
        ref={ref}
        role={role}
        className={cn(
          "flex items-center",
          tabListVariantStyles[variant],
          className
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
);

TabsList.displayName = "TabsList";

export interface TabsTriggerProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange" | "type"> {
  readonly id: string;
  readonly disabled?: boolean;
}

export const TabsTrigger = forwardRef<HTMLButtonElement, TabsTriggerProps>(
  (
    { className, id, disabled = false, children, ...props },
    ref
  ) => {
    const { activeId, setActiveId, variant, baseId } =
      useTabsContext("TabsTrigger");
    const isActive = activeId === id;
    const styles = tabTriggerVariantStyles[variant];

    return (
      <button
        ref={ref}
        type="button"
        role="tab"
        id={`${baseId}-tab-${id}`}
        aria-selected={isActive}
        aria-controls={`${baseId}-panel-${id}`}
        tabIndex={isActive ? 0 : -1}
        disabled={disabled}
        onClick={() => {
          if (!disabled) setActiveId(id);
        }}
        className={cn(
          styles.base,
          isActive ? styles.active : styles.inactive,
          disabled && "opacity-50 pointer-events-none",
          className
        )}
        {...props}
      >
        {children}
      </button>
    );
  }
);

TabsTrigger.displayName = "TabsTrigger";

export interface TabsPanelProps extends HTMLAttributes<HTMLDivElement> {
  readonly id: string;
  readonly forceMount?: boolean;
}

export const TabsPanel = forwardRef<HTMLDivElement, TabsPanelProps>(
  ({ className, id, forceMount = false, children, ...props }, ref) => {
    const { activeId, baseId } = useTabsContext("TabsPanel");
    const isActive = activeId === id;
    if (!isActive && !forceMount) return null;
    return (
      <div
        ref={ref}
        role="tabpanel"
        id={`${baseId}-panel-${id}`}
        aria-labelledby={`${baseId}-tab-${id}`}
        hidden={!isActive}
        tabIndex={0}
        className={cn("mt-4 focus:outline-none", className)}
        {...props}
      >
        {children}
      </div>
    );
  }
);

TabsPanel.displayName = "TabsPanel";
