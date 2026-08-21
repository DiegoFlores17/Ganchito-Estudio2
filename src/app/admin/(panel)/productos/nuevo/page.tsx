import { requireAdmin } from "@/lib/admin-auth";
import { getAllCategories } from "@/lib/catalog";
import { ProductForm } from "@/components/admin/product-form";

export default async function NuevoProductoPage() {
  await requireAdmin();
  const categories = await getAllCategories();

  return (
    <div>
      <h1 className="text-2xl font-medium text-foreground">Nuevo producto</h1>
      <div className="mt-6">
        <ProductForm categories={categories} />
      </div>
    </div>
  );
}
