"use client";

import { ReactNode, useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { CircleCheck, CircleX, Info, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export type ToastType = "success" | "error" | "warning" | "info";

export interface Toast {
  readonly id: string;
  readonly type: ToastType;
  readonly title: string;
  readonly message?: string;
  readonly duration?: number;
  readonly action?: {
    readonly label: string;
    readonly onClick: () => void;
  };
  readonly dismissible?: boolean;
}

export interface ToastProps extends Omit<Toast, "id"> {}

const typeStyles: Record<ToastType, string> = {
  success: "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-800 dark:text-green-300",
  error: "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-800 dark:text-red-300",
  warning: "bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800 text-yellow-800 dark:text-yellow-300",
  info: "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-300",
};

const typeIcons: Record<ToastType, ReactNode> = {
  success: <CircleCheck className="h-5 w-5 flex-shrink-0" aria-hidden="true" />,
  error: <CircleX className="h-5 w-5 flex-shrink-0" aria-hidden="true" />,
  warning: (
    <TriangleAlert className="h-5 w-5 flex-shrink-0" aria-hidden="true" />
  ),
  info: <Info className="h-5 w-5 flex-shrink-0" aria-hidden="true" />,
};

interface ToastItemProps {
  readonly toast: Toast;
  readonly onDismiss: (id: string) => void;
}

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    if (toast.duration !== 0 && toast.duration !== Infinity) {
      const timer = setTimeout(() => {
        setIsExiting(true);
        setTimeout(() => onDismiss(toast.id), 200);
      }, toast.duration ?? 5000);

      return () => clearTimeout(timer);
    }
  }, [toast.duration, toast.id, onDismiss]);

  const handleDismiss = () => {
    setIsExiting(true);
    setTimeout(() => onDismiss(toast.id), 200);
  };

  return (
    <div
      className={cn(
        "flex items-start space-x-3 p-4 rounded-lg border shadow-lg",
        "min-w-[300px] max-w-md",
        "animate-in slide-in-from-right-full duration-200",
        isExiting && "animate-out slide-out-to-right-full duration-200",
        typeStyles[toast.type]
      )}
      role="alert"
      aria-live="polite"
    >
      <div className="flex-shrink-0 text-current">{typeIcons[toast.type]}</div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{toast.title}</p>
        {toast.message && (
          <p className="mt-1 text-sm opacity-90">{toast.message}</p>
        )}
        {toast.action && (
          <button
            type="button"
            onClick={toast.action.onClick}
            className="mt-2 text-sm font-medium underline hover:no-underline focus:outline-none focus:ring-2 focus:ring-current focus:ring-offset-2"
          >
            {toast.action.label}
          </button>
        )}
      </div>

      {toast.dismissible !== false && (
        <button
          type="button"
          onClick={handleDismiss}
          className="flex-shrink-0 text-current opacity-50 hover:opacity-100 transition-opacity"
          aria-label="Dismiss"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

interface ToasterProps {
  readonly toasts: readonly Toast[];
  readonly onDismiss: (id: string) => void;
  readonly position?: "top-right" | "top-left" | "bottom-right" | "bottom-left" | "top-center" | "bottom-center";
}

const positionClasses: Record<NonNullable<ToasterProps["position"]>, string> = {
  "top-right": "top-4 right-4",
  "top-left": "top-4 left-4",
  "bottom-right": "bottom-4 right-4",
  "bottom-left": "bottom-4 left-4",
  "top-center": "top-4 left-1/2 -translate-x-1/2",
  "bottom-center": "bottom-4 left-1/2 -translate-x-1/2",
};

function Toaster({ toasts, onDismiss, position = "top-right" }: ToasterProps) {
  if (toasts.length === 0) return null;

  const toasterContent = (
    <div
      className={cn(
        "fixed z-[100] flex flex-col space-y-2 pointer-events-none",
        positionClasses[position]
      )}
      role="region"
      aria-label="Notifications"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );

  if (typeof window === "undefined") return null;

  return createPortal(toasterContent, document.body);
}

// Toast context/hooks for global management
import { createContext, useContext, useMemo, ReactElement } from "react";

interface ToastContextValue {
  readonly addToast: (toast: Omit<Toast, "id">) => string;
  readonly dismissToast: (id: string) => void;
  readonly dismissAll: () => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

interface ToastProviderProps {
  readonly children: ReactNode;
  readonly position?: ToasterProps["position"];
}

export function ToastProvider({ children, position = "top-right" }: ToastProviderProps) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((toast: Omit<Toast, "id">): string => {
    const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newToast: Toast = { ...toast, id };
    setToasts((prev) => [...prev, newToast]);
    return id;
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const dismissAll = useCallback(() => {
    setToasts([]);
  }, []);

  const value = useMemo(
    () => ({ addToast, dismissToast, dismissAll }),
    [addToast, dismissToast, dismissAll]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Toaster toasts={toasts} onDismiss={dismissToast} position={position} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}

// Helper functions for common toast types
export function useToastHelpers() {
  const { addToast, dismissToast, dismissAll } = useToast();

  return useMemo(
    () => ({
      success: (title: string, message?: string, options?: Partial<Toast>) =>
        addToast({ type: "success", title, message, ...options }),
      error: (title: string, message?: string, options?: Partial<Toast>) =>
        addToast({ type: "error", title, message, ...options }),
      warning: (title: string, message?: string, options?: Partial<Toast>) =>
        addToast({ type: "warning", title, message, ...options }),
      info: (title: string, message?: string, options?: Partial<Toast>) =>
        addToast({ type: "info", title, message, ...options }),
      dismiss: dismissToast,
      dismissAll,
    }),
    [addToast, dismissToast, dismissAll]
  );
}