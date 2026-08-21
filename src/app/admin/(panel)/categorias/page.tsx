import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import { getAdminCategories, type CategoryOrigin } from "@/lib/admin-categories";
import { ToggleCategoryVisibleButton } from "@/components/admin/toggle-category-visible-button";

const ORIGIN_LABEL: Record<CategoryOrigin, string> = {
  ZECAT: "Zecat",
  CDO: "CDO",
  PROPIA: "Propia",
};

/// Cada origen con su color, para poder barrer la tabla de un vistazo cuando
/// dos categorias se llaman igual.
const ORIGIN_CLASSES: Record<CategoryOrigin, string> = {
  // Violeta y amarillo son los dos colores de la marca, y se distinguen entre
  // si de un vistazo. El texto del amarillo va oscuro: el #fff835 es
  // demasiado claro para poner texto blanco encima.
  ZECAT: "bg-primary/10 text-primary",
  CDO: "bg-accent/40 text-foreground/80",
  PROPIA: "bg-foreground/10 text-foreground/60",
};

export default async function CategoriasPage() {
  // La autorizacion no puede quedar solo en el layout: ver el comentario de
  // requireAdmin() en src/lib/admin-auth.ts.
  await requireAdmin();

  const categories = await getAdminCategories();
  const ocultas = categories.filter((c) => !c.visible).length;

  return (
    <div>
      <div>
        <h1 className="text-2xl font-medium text-foreground">Categorías</h1>
        <p className="mt-1 max-w-2xl text-sm text-foreground/60">
          Elegí cuáles se ofrecen como filtro en el catálogo. Los conectores
          importan todas las categorías del proveedor, incluidas campañas y
          ofertas temporales.
        </p>
      </div>

      {/* Esto no es decoracion: sin decirlo, "Ocultar" se lee como "sacar del
          catalogo", que es lo contrario de lo que hace. */}
      <p className="mt-6 rounded-xl border border-foreground/10 bg-primary/[0.04] px-4 py-3 text-sm text-foreground/70">
        <strong className="font-medium text-foreground">
          Ocultar una categoría no oculta sus productos.
        </strong>{" "}
        Los productos siguen apareciendo en el catálogo y en la búsqueda: lo
        único que se saca es la categoría del selector de filtros.
      </p>

      <div className="mt-8 overflow-hidden rounded-xl border border-foreground/10 bg-background">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-foreground/10 text-left text-xs text-foreground/50">
              <th className="px-4 py-3 font-medium">Categoría</th>
              <th className="px-4 py-3 font-medium">Origen</th>
              <th className="px-4 py-3 font-medium">Productos</th>
              <th className="px-4 py-3 font-medium">En el filtro</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {categories.map((category) => (
              <tr
                key={category.id}
                className="border-b border-foreground/5 last:border-0"
              >
                <td className="px-4 py-3">
                  <span className="font-medium text-foreground">
                    {category.name}
                  </span>
                  <p className="text-xs text-foreground/40">{category.slug}</p>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={
                      "rounded-full px-2.5 py-1 text-xs font-medium " +
                      ORIGIN_CLASSES[category.origin]
                    }
                  >
                    {ORIGIN_LABEL[category.origin]}
                  </span>
                </td>
                <td className="px-4 py-3 text-foreground/70">
                  {/* Una categoria sin productos no le sirve de filtro a
                      nadie, asi que el cero se marca en vez de pasar
                      desapercibido entre los demas numeros. */}
                  {category.productCount === 0 ? (
                    <span className="text-foreground/40">0</span>
                  ) : (
                    category.productCount
                  )}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={
                      "rounded-full px-2.5 py-1 text-xs font-medium " +
                      (category.visible
                        ? "bg-primary/10 text-primary"
                        : "bg-foreground/10 text-foreground/50")
                    }
                  >
                    {category.visible ? "Visible" : "Oculta"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-3">
                    {/* Ver la categoria como la ve el cliente. El link va
                        igual cuando esta oculta: el filtro por URL sigue
                        resolviendo, solo desaparece del selector. */}
                    <Link
                      href={`/catalogo?categoria=${category.slug}`}
                      target="_blank"
                      className="rounded-lg border border-foreground/15 px-3 py-1.5 text-xs font-medium text-foreground/80 transition-colors hover:border-primary hover:text-primary"
                    >
                      Ver
                    </Link>
                    <ToggleCategoryVisibleButton
                      categoryId={category.id}
                      categoryName={category.name}
                      visible={category.visible}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {categories.length === 0 && (
          <p className="px-4 py-10 text-center text-sm text-foreground/50">
            Todavía no hay categorías. Se crean solas al sincronizar un
            proveedor.
          </p>
        )}
      </div>

      <p className="mt-4 text-xs text-foreground/50">
        {categories.length} categorías · {ocultas} ocultas
      </p>
    </div>
  );
}
