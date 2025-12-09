"use client";

import { createContext, useContext, useState, ReactNode } from "react";

type CollectionFilterContextType = {
  showOnlyCollected: boolean;
  toggleCollectionFilter: () => void;
};

const CollectionFilterContext = createContext<CollectionFilterContextType | undefined>(undefined);

export function CollectionFilterProvider({ children }: { children: ReactNode }) {
  const [showOnlyCollected, setShowOnlyCollected] = useState(false);

  const toggleCollectionFilter = () => {
    setShowOnlyCollected((prev) => !prev);
  };

  return (
    <CollectionFilterContext.Provider value={{ showOnlyCollected, toggleCollectionFilter }}>
      {children}
    </CollectionFilterContext.Provider>
  );
}

export function useCollectionFilter() {
  const context = useContext(CollectionFilterContext);
  if (context === undefined) {
    throw new Error("useCollectionFilter must be used within a CollectionFilterProvider");
  }
  return context;
}

