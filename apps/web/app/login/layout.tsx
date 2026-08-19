import type { Metadata } from 'next';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import { PractitionerProductProvider } from '@/components/app/PractitionerProductProvider';
import { PRODUCTS, practitionerProductCopy, productFromHost } from '@/lib/product';

async function requestProduct() {
  const host = (await headers()).get('host');
  const resolved = productFromHost(host);
  return resolved.vertical === null ? PRODUCTS.mind : resolved;
}

export async function generateMetadata(): Promise<Metadata> {
  const product = await requestProduct();
  const copy = practitionerProductCopy(product);
  return { title: copy.metadataTitle, description: copy.metadataDescription };
}

export default async function LoginLayout({ children }: { children: ReactNode }) {
  const host = (await headers()).get('host');
  const resolved = productFromHost(host);
  const product = resolved.vertical === null ? PRODUCTS.mind : resolved;
  return (
    <PractitionerProductProvider productKey={product.key}>{children}</PractitionerProductProvider>
  );
}
