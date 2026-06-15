"use client";

import { HTMLAttributes, forwardRef, useState } from "react";
import { cn } from "@/lib/utils/cn";

export type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl";

export interface AvatarProps extends HTMLAttributes<HTMLDivElement> {
  readonly src?: string | null;
  readonly alt?: string;
  readonly fallback?: string;
  readonly size?: AvatarSize;
  readonly shape?: "circle" | "square";
  readonly status?: "online" | "offline" | "busy" | "away";
  readonly statusPosition?: "bottom-right" | "bottom-left" | "top-right" | "top-left";
}

const sizeClasses: Record<AvatarSize, string> = {
  xs: "h-6 w-6 text-[10px]",
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-12 w-12 text-base",
  xl: "h-16 w-16 text-lg",
};

const statusSizeClasses: Record<AvatarSize, string> = {
  xs: "h-1.5 w-1.5",
  sm: "h-2 w-2",
  md: "h-2.5 w-2.5",
  lg: "h-3 w-3",
  xl: "h-4 w-4",
};

const statusColors = {
  online: "bg-green-500",
  offline: "bg-gray-400",
  busy: "bg-red-500",
  away: "bg-yellow-500",
} as const;

const statusPositions = {
  "bottom-right": "bottom-0 right-0",
  "bottom-left": "bottom-0 left-0",
  "top-right": "top-0 right-0",
  "top-left": "top-0 left-0",
} as const;

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export const Avatar = forwardRef<HTMLDivElement, AvatarProps>(
  (
    {
      className,
      src,
      alt,
      fallback,
      size = "md",
      shape = "circle",
      status,
      statusPosition = "bottom-right",
      ...props
    },
    ref
  ) => {
    const [imageError, setImageError] = useState(false);
    const showFallback = !src || imageError;

    const handleError = () => {
      setImageError(true);
    };

    const initials = fallback ?? alt ?? "?";

    return (
      <div
        ref={ref}
        className={cn(
          "relative inline-flex items-center justify-center overflow-hidden bg-gray-100 dark:bg-gray-800 font-medium text-gray-600 dark:text-gray-300",
          "flex-shrink-0",
          sizeClasses[size],
          shape === "circle" ? "rounded-full" : "rounded-lg",
          className
        )}
        {...props}
      >
        {!showFallback && src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={alt ?? ""}
            onError={handleError}
            className="h-full w-full object-cover"
            aria-hidden={!!alt}
          />
        ) : (
          <span aria-label={alt ?? initials}>{getInitials(initials)}</span>
        )}

        {status && (
          <span
            className={cn(
              "absolute border-2 border-white dark:border-gray-800 rounded-full",
              statusSizeClasses[size],
              statusColors[status],
              statusPositions[statusPosition]
            )}
            aria-label={`Status: ${status}`}
          />
        )}
      </div>
    );
  }
);

Avatar.displayName = "Avatar";

// AvatarGroup for stacked avatars
export interface AvatarGroupProps extends HTMLAttributes<HTMLDivElement> {
  readonly avatars: readonly AvatarProps[];
  readonly max?: number;
  readonly size?: AvatarSize;
  readonly overlap?: boolean;
}

export function AvatarGroup({
  avatars,
  max = 5,
  size = "md",
  overlap = true,
  className,
  ...props
}: AvatarGroupProps) {
  const visibleAvatars = avatars.slice(0, max);
  const remainingCount = avatars.length - max;

  return (
    <div
      className={cn(
        "inline-flex",
        overlap && "-space-x-2",
        className
      )}
      {...props}
    >
      {visibleAvatars.map((avatarProps, index) => (
        <Avatar
          key={`${avatarProps.src ?? avatarProps.fallback ?? avatarProps.alt ?? index}-${index}`}
          {...avatarProps}
          size={size}
          className={cn(
            "ring-2 ring-white dark:ring-gray-800",
            overlap && index > 0 && "z-[auto]"
          )}
        />
      ))}
      {remainingCount > 0 && (
        <div
          className={cn(
            "inline-flex items-center justify-center font-medium ring-2 ring-white dark:ring-gray-800",
            sizeClasses[size],
            "rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300"
          )}
          aria-label={`${remainingCount} more users`}
        >
          +{remainingCount}
        </div>
      )}
    </div>
  );
}