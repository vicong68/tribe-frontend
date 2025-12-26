"use client";

import { type ComponentProps, memo, useMemo } from "react";
import { Streamdown } from "streamdown";
import { cn } from "@/lib/utils";
import { useIsMounted } from "@/hooks/use-is-mounted";

type ResponseProps = ComponentProps<typeof Streamdown> & {
  isStreaming?: boolean;
};

/**
 * Response component for rendering markdown content with Streamdown
 * 
 * Handles hydration mismatch by rendering a simple placeholder on the server
 * and the full Streamdown component on the client. This is necessary because
 * Streamdown processes links differently on server vs client (server may block
 * certain URLs for security reasons).
 * 
 * @param className - Additional CSS classes
 * @param isStreaming - Whether to enable typing animation effect
 * @param children - Markdown content to render
 */
function ResponseComponent({
  className,
  isStreaming = false,
  ...props
}: ResponseProps) {
  const isMounted = useIsMounted();

  // Memoize className to avoid recalculation on every render
  const streamdownClassName = useMemo(
    () =>
      cn(
        "size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_code]:whitespace-pre-wrap [&_code]:break-words [&_pre]:max-w-full [&_pre]:overflow-x-auto",
        className
      ),
    [className]
  );

  // Server-side render: Return simple placeholder to avoid hydration mismatch
  // The placeholder uses the same className to maintain consistent styling
  if (!isMounted) {
    return (
      <div className={streamdownClassName} suppressHydrationWarning>
        {typeof props.children === "string" ? (
          <div className="whitespace-pre-wrap break-words">
            {props.children}
          </div>
        ) : (
          props.children
        )}
      </div>
    );
  }

  // Client-side render: Use Streamdown for full markdown processing
  // This ensures links are properly rendered and interactive
  return (
    <Streamdown
      className={streamdownClassName}
      // Control typing animation effect
      // When isStreaming is true, enables animation effect
      // Animation speed is matched with backend buffer and frontend throttle
      isAnimating={isStreaming}
      {...props}
    />
  );
}

/**
 * Memoized comparison function for Response component
 * 
 * Only re-renders when:
 * - children content changes
 * - isStreaming state changes
 * - className changes
 */
function areEqual(
  prevProps: ResponseProps,
  nextProps: ResponseProps
): boolean {
  return (
    prevProps.children === nextProps.children &&
    prevProps.isStreaming === nextProps.isStreaming &&
    prevProps.className === nextProps.className
  );
}

export const Response = memo(ResponseComponent, areEqual);

Response.displayName = "Response";
