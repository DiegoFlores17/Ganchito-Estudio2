import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { getCategories } from "@/lib/catalog";
import { getManualProductById } from "@/lib/admin-products";
import { ProductForm } from "@/components/admin/product-form";

export default async function EditarProductoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;

  const [product, categories] = await Promise.all([
    getManualProductById(id),
    getCategories(),
  ]);
  if (!product) notFound();

  return (
    <div>
      <h1 className="text-2xl font-medium text-foreground">
        Editar producto
      </h1>
      <div className="mt-6">
        <ProductForm
          categories={categories}
          initialProduct={{
            id: product.id,
            name: product.name,
            description: product.description,
            supplierName: product.supplierName,
            categoryId: product.categoryId,
            costPrice: Number(product.costPrice),
            images: product.images.map((img) => ({
              id: img.id,
              url: img.url,
            })),
            variants: product.variants.map((v) => ({
              colorName: v.colorName,
              sizeName: v.sizeName,
              stock: v.stock,
            })),
          }}
        />
      </div>
    </div>
  );
}
