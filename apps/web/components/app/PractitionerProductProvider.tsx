'use client';

import { createContext, useContext, type ReactNode } from 'react';
import {
  PRODUCTS,
  practitionerProductCopy,
  type PractitionerProductCopy,
  type Product,
  type ProductKey,
} from '@/lib/product';

interface PractitionerProductContextValue {
  product: Product;
  copy: PractitionerProductCopy;
}

const fallback: PractitionerProductContextValue = {
  product: PRODUCTS.mind,
  copy: practitionerProductCopy(PRODUCTS.mind),
};

const PractitionerProductContext = createContext<PractitionerProductContextValue>(fallback);

export function PractitionerProductProvider({
  productKey,
  children,
}: {
  productKey: ProductKey;
  children: ReactNode;
}) {
  const product = PRODUCTS[productKey];
  return (
    <PractitionerProductContext.Provider
      value={{ product, copy: practitionerProductCopy(product) }}
    >
      {children}
    </PractitionerProductContext.Provider>
  );
}

export function usePractitionerProduct(): PractitionerProductContextValue {
  return useContext(PractitionerProductContext);
}
