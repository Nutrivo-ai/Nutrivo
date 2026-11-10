import { SupplierLoading, SupplierPage } from "@/components/supplier/SupplierPortal";

// S-NV2-028 while the request is opened.
export default function Loading() {
  return (
    <SupplierPage>
      <SupplierLoading />
    </SupplierPage>
  );
}
