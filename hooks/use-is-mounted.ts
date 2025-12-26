"use client";

import { useEffect, useState } from "react";

/**
 * Hook to check if component is mounted on the client side
 * 
 * Useful for avoiding hydration mismatches when server and client
 * render different content (e.g., due to browser APIs, extensions, etc.)
 * 
 * @returns true if component is mounted on client, false during SSR
 * 
 * @example
 * ```tsx
 * function MyComponent() {
 *   const isMounted = useIsMounted();
 *   
 *   if (!isMounted) {
 *     return <div>Loading...</div>;
 *   }
 *   
 *   return <ClientOnlyComponent />;
 * }
 * ```
 */
export function useIsMounted(): boolean {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    // Set mounted state after hydration
    // This runs only on the client side
    setIsMounted(true);
  }, []);

  return isMounted;
}

