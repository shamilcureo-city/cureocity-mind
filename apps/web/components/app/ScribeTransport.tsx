'use client';

import { createContext, useContext, type ReactNode } from 'react';

const ScribeTransportContext = createContext<typeof fetch | null>(null);

/** A dependency seam for fictional development previews; never bypasses server authority. */
export function ScribeTransportProvider({
  fetcher,
  children,
}: {
  fetcher: typeof fetch;
  children: ReactNode;
}) {
  return (
    <ScribeTransportContext.Provider value={fetcher}>{children}</ScribeTransportContext.Provider>
  );
}

export function useScribeFetch(): typeof fetch {
  return useContext(ScribeTransportContext) ?? fetch;
}
