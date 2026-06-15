"use client";

import {
  cloneElement,
  Fragment,
  isValidElement,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactElement,
  ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils/cn";

export interface DropdownItem {
  readonly label: string;
  readonly onClick: () => void;
  readonly icon?: ReactNode;
  readonly disabled?: boolean;
  readonly danger?: boolean;
  readonly divider?: boolean;
  readonly shortcut?: string;
}

export interface DropdownProps {
  readonly trigger: ReactNode;
  readonly items: readonly DropdownItem[];
  readonly align?: "left" | "right";
  readonly offset?: number;
  readonly closeOnClick?: boolean;
  /** Optional non-interactive header rendered above the menu items. */
  readonly header?: ReactNode;
}

function DropdownContent({
  items,
  align = "right",
  offset = 4,
  closeOnClick = true,
  onClose,
  referenceRect,
  header,
}: {
  readonly items: readonly DropdownItem[];
  readonly align: "left" | "right";
  readonly offset: number;
  readonly closeOnClick: boolean;
  readonly onClose: () => void;
  readonly referenceRect: DOMRect | null;
  readonly header?: ReactNode;
}): JSX.Element | null {
  const contentRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef<HTMLDivElement>(null);

  // Calculate position
  useEffect(() => {
    if (!referenceRect || !contentRef.current) return;

    const content = contentRef.current;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const contentRect = content.getBoundingClientRect();

    let left = referenceRect.left;
    let top = referenceRect.bottom + offset;

    if (align === "right") {
      left = referenceRect.right - contentRect.width;
    }

    // Adjust if off-screen horizontally
    if (left < 8) left = 8;
    if (left + contentRect.width > viewportWidth - 8) {
      left = viewportWidth - contentRect.width - 8;
    }

    // Adjust if off-screen vertically
    if (top + contentRect.height > viewportHeight - 8) {
      top = referenceRect.top - contentRect.height - offset;
    }

    content.style.left = `${left}px`;
    content.style.top = `${top}px`;
  }, [referenceRect, align, offset]);

  // Focus management
  useEffect(() => {
    const focusableItems = itemsRef.current?.querySelectorAll<HTMLElement>(
      '[role="menuitem"]:not([disabled])'
    );
    focusableItems?.[0]?.focus();

    const handleKeyDown = (event: KeyboardEvent): void => {
      const items = itemsRef.current?.querySelectorAll<HTMLElement>(
        '[role="menuitem"]:not([disabled])'
      );
      if (!items || items.length === 0) return;

      const currentIndex = Array.from(items).findIndex(
        (item) => item === document.activeElement
      );

      let nextIndex = currentIndex;

      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          nextIndex = (currentIndex + 1) % items.length;
          break;
        case "ArrowUp":
          event.preventDefault();
          nextIndex = (currentIndex - 1 + items.length) % items.length;
          break;
        case "Home":
          event.preventDefault();
          nextIndex = 0;
          break;
        case "End":
          event.preventDefault();
          nextIndex = items.length - 1;
          break;
        case "Escape":
          event.preventDefault();
          onClose();
          return;
        case "Tab":
          onClose();
          return;
        default:
          return;
      }

      items[nextIndex]?.focus();
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [items, onClose]);

  // Click outside handler
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent): void => {
      if (
        contentRef.current &&
        !contentRef.current.contains(event.target as Node)
      ) {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  const portalContent = (
    <div
      ref={contentRef}
      className="fixed z-50 min-w-[160px] max-w-[320px] bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1"
      role="menu"
      aria-orientation="vertical"
      style={{ position: "fixed" }}
    >
      {header && (
        <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700">
          {header}
        </div>
      )}
      <div ref={itemsRef} className="space-y-0.5">
        {items.map((item, index) => {
          if (item.divider) {
            return (
              <hr
                key={`divider-${index}`}
                className="my-1 border-gray-200 dark:border-gray-700"
                role="separator"
              />
            );
          }

          return (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                if (!item.disabled) {
                  item.onClick();
                  if (closeOnClick) onClose();
                }
              }}
              className={cn(
                "w-full flex items-center space-x-2 px-3 py-2 text-sm transition-colors",
                "focus:outline-none focus:bg-gray-100 dark:focus:bg-gray-700",
                item.disabled && "opacity-50 cursor-not-allowed",
                item.danger
                  ? "text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                  : "text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
              )}
              aria-disabled={item.disabled}
            >
              {item.icon && (
                <span className="flex-shrink-0 h-4 w-4" aria-hidden="true">
                  {item.icon}
                </span>
              )}
              <span className="flex-1 text-left">{item.label}</span>
              {item.shortcut && (
                <span className="flex-shrink-0 text-xs text-gray-400 dark:text-gray-500 font-mono">
                  {item.shortcut}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );

  if (typeof window === "undefined") return null;

  return createPortal(portalContent, document.body);
}

export function Dropdown({
  trigger,
  items,
  align = "right",
  offset = 4,
  closeOnClick = true,
  header,
}: DropdownProps): JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLElement | null>(null);
  const referenceRectRef = useRef<DOMRect | null>(null);

  const open = useCallback((): void => {
    if (triggerRef.current) {
      referenceRectRef.current = triggerRef.current.getBoundingClientRect();
    }
    setIsOpen(true);
  }, []);

  const close = useCallback((): void => {
    setIsOpen(false);
    referenceRectRef.current = null;
  }, []);

  const toggle = useCallback((): void => {
    if (isOpen) {
      close();
    } else {
      open();
    }
  }, [isOpen, open, close]);

  // Handle click on trigger
  const handleTriggerClick = useCallback(
    (event: ReactMouseEvent): void => {
      event.stopPropagation();
      toggle();
    },
    [toggle]
  );

  // Handle keyboard on trigger
  const handleTriggerKeyDown = useCallback(
    (event: ReactKeyboardEvent): void => {
      if (
        event.key === "Enter" ||
        event.key === " " ||
        event.key === "ArrowDown"
      ) {
        event.preventDefault();
        open();
      } else if (event.key === "Escape") {
        close();
      }
    },
    [open, close]
  );

  // Clone trigger and add handlers if it's a valid element
  let triggerWithHandlers: ReactNode = trigger;
  if (isValidElement(trigger)) {
    const element = trigger as ReactElement<{
      ref?: React.Ref<HTMLElement>;
      onClick?: (e: ReactMouseEvent) => void;
      onKeyDown?: (e: ReactKeyboardEvent) => void;
      "aria-haspopup"?: "menu";
      "aria-expanded"?: boolean;
    }>;
    triggerWithHandlers = cloneElement(element, {
      ref: triggerRef,
      onClick: (e: ReactMouseEvent) => {
        element.props.onClick?.(e);
        handleTriggerClick(e);
      },
      onKeyDown: (e: ReactKeyboardEvent) => {
        element.props.onKeyDown?.(e);
        handleTriggerKeyDown(e);
      },
      "aria-haspopup": "menu",
      "aria-expanded": isOpen,
    });
  }

  return (
    <Fragment>
      <span className="inline-block" onClick={handleTriggerClick}>
        {triggerWithHandlers}
      </span>
      {isOpen && (
        <DropdownContent
          items={items}
          align={align}
          offset={offset}
          closeOnClick={closeOnClick}
          onClose={close}
          referenceRect={referenceRectRef.current}
          header={header}
        />
      )}
    </Fragment>
  );
}
