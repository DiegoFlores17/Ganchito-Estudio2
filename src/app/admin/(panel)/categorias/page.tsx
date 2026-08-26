import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import {
  getAdminCategoriesView,
  getCanonicalOptions,
  type AdminCategoryRow,
  type CategoryOrigin,
} from "@/lib/admin-categories";
import { ToggleCategoryVisibleButton } from "@/components/admin/toggle-category-visible-button";
import { CategoryUnifySelect } from "@/components/admin/category-unify-select";
import { NewCategoryForm } from "@/components/admin/new-category-form";
import { CategorySuggestion } from "@/components/admin/category-suggestion";

const ORIGIN_LABEL: Record<CategoryOrigin, string> = {
  ZECAT: "Zecat",
  CDO: "CDO",
  PROPIA: "Propia",
};

/// Cada origen con su color, para poder barrer la tabla de un vistazo cuando
/// dos categorias se llaman igual. Violeta y amarillo son los dos colores de
/// la marca y se distinguen entre si. El texto del amarillo va oscuro: el
/// #fff835 es demasiado claro para poner texto blanco encima.
const ORIGIN_CLASSES: Record<CategoryOrigin, string> = {
  ZECAT: "bg-primary/10 text-primary",
  CDO: "bg-accent/40 text-foreground/80",
  PROPIA: "bg-foreground/10 text-foreground/60",
};

function OriginBadge({ origin }: { origin: CategoryOrigin }) {
  return (
    <span
      className={
        "rounded-full px-2.5 py-1 text-xs font-medium " + ORIGIN_CLASSES[origin]
      }
    >
      {ORIGIN_LABEL[origin]}
    </span>
  );
}

function VisibleBadge({ visible }: { visible: boolean }) {
  return (
    <span
      className={
        "rounded-full px-2.5 py-1 text-xs font-medium " +
        (visible
          ? "bg-primary/10 text-primary"
          : "bg-foreground/10 text-foreground/50")
      }
    >
      {visible ? "Visible" : "Oculta"}
    </span>
  );
}

/// Una categoria sin productos no le sirve de filtro a nadie, asi que el cero
/// se marca en vez de pasar desapercibido entre los demas numeros.
function ProductCount({ count }: { count: number }) {
  if (count === 0) return <span className="text-foreground/40">0</span>;
  return <>{count}</>;
}

export default async function CategoriasPage() {
  // La autorizacion no puede quedar solo en el layout: ver el comentario de
  // requireAdmin() en src/lib/admin-auth.ts.
  await requireAdmin();

  const [view, canonicalOptions] = await Promise.all([
    getAdminCategoriesView(),
    getCanonicalOptions(),
  ]);

  return (
    <div>
      <div>
        <h1 className="text-2xl font-medium text-foreground">Categorías</h1>
        <p className="mt-1 max-w-2xl text-sm text-foreground/60">
          Las categorías de la tienda son tuyas. Los proveedores traen las
          suyas, y acá se decide cuáles se ofrecen como filtro y cuáles se
          unifican bajo un mismo nombre.
        </p>
      </div>

      {/* Esto no es decoracion: sin decirlo, "Ocultar" se lee como "sacar del
          catalogo", que es lo contrario de lo que hace. */}
      <p className="mt-6 rounded-xl border border-foreground/10 bg-primary/[0.04] px-4 py-3 text-sm text-foreground/70">
        <strong className="font-medium text-foreground">
          Ocultar una categoría no oculta sus productos.
        </strong>{" "}
        Los productos siguen apareciendo en el catálogo y en la búsqueda: lo
        único que se saca es la categoría del selector de filtros.{" "}
        <strong className="font-medium text-foreground">
          Ojo con ocultar duplicadas:
        </strong>{" "}
        como cada producto tiene una sola categoría, sus productos quedan sin
        ninguna vía de filtro. Para eso está unificar.
      </p>

      {view.suggestions.length > 0 && (
        <section className="mt-10">
          <h2 className="text-lg font-medium text-foreground">
            Se parecen — ¿las unificás?
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-foreground/60">
            Categorías de distinto origen que se llaman igual. Hoy el cliente
            ve dos filtros con el mismo nombre.{" "}
            <strong className="font-medium text-foreground">
              Nada se aplica solo:
            </strong>{" "}
            revisá el nombre y confirmá.
          </p>
          <div className="mt-4 flex flex-col gap-3">
            {view.suggestions.map((suggestion) => (
              <CategorySuggestion
                key={suggestion.key}
                defaultName={
                  // El mas corto suele ser el mas generico ("Escritura" antes
                  // que "Escritura y accesorios"). Es solo un valor inicial.
                  [...suggestion.members]
                    .map((m) => m.name)
                    .sort((a, b) => a.length - b.length)[0] ?? ""
                }
                members={suggestion.members.map((m) => ({
                  id: m.id,
                  name: m.name,
                  origin: ORIGIN_LABEL[m.origin],
                  productCount: m.productCount,
                }))}
              />
            ))}
          </div>
        </section>
      )}

      <section className="mt-10">
        <h2 className="text-lg font-medium text-foreground">
          Categorías de la tienda
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-foreground/60">
          Son las que ve el cliente en el filtro. El total incluye los
          productos de las categorías de proveedor unificadas debajo.
        </p>

        {/* overflow-x-auto y NO overflow-hidden: con `hidden`, en un celular
            las columnas que no entran quedan cortadas y sin ninguna forma de
            llegar a ellas — incluida la del botón de acción. */}
        <div className="mt-4 overflow-x-auto rounded-xl border border-foreground/10 bg-background">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-foreground/10 text-left text-xs text-foreground/50">
                <th className="px-4 py-3 font-medium">Categoría</th>
                <th className="px-4 py-3 font-medium">Unificadas</th>
                <th className="px-4 py-3 font-medium">Productos</th>
                <th className="px-4 py-3 font-medium">En el filtro</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {view.canonicals.map((canonical) => (
                <tr
                  key={canonical.id}
                  className="border-b border-foreground/5 last:border-0 align-top"
                >
                  <td className="px-4 py-3">
                    <span className="font-medium text-foreground">
                      {canonical.name}
                    </span>
                    <p className="text-xs text-foreground/40">
                      {canonical.slug}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    {canonical.aliases.length === 0 ? (
                      <span className="text-xs text-foreground/40">
                        Ninguna todavía
                      </span>
                    ) : (
                      <ul className="flex flex-col gap-1.5">
                        {canonical.aliases.map((alias) => (
                          <li
                            key={alias.id}
                            className="flex items-center gap-2 text-xs"
                          >
                            <OriginBadge origin={alias.origin} />
                            <span className="text-foreground/70">
                              {alias.name}
                            </span>
                            <span className="text-foreground/40">
                              ({alias.productCount})
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-medium text-foreground">
                      <ProductCount count={canonical.totalProductCount} />
                    </span>
                    {canonical.aliases.length > 0 && (
                      <p className="text-xs text-foreground/40">
                        {canonical.productCount} propios
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <VisibleBadge visible={canonical.visible} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-3">
                      <Link
                        href={`/catalogo?categoria=${canonical.slug}`}
                        target="_blank"
                        className="rounded-lg border border-foreground/15 px-3 py-1.5 text-xs font-medium text-foreground/80 transition-colors hover:border-primary hover:text-primary"
                      >
                        Ver
                      </Link>
                      <ToggleCategoryVisibleButton
                        categoryId={canonical.id}
                        categoryName={canonical.name}
                        visible={canonical.visible}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {view.canonicals.length === 0 && (
            <p className="px-4 py-10 text-center text-sm text-foreground/50">
              Todavía no creaste ninguna categoría propia. Creá una acá abajo y
              después unificá las de proveedor debajo de ella.
            </p>
          )}
        </div>

        <div className="mt-4">
          <NewCategoryForm />
        </div>
      </section>

      <section className="mt-12">
        <h2 className="text-lg font-medium text-foreground">
          Categorías de proveedor
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-foreground/60">
          Las crean los conectores en cada sync y no se pueden editar. Las que
          no estén unificadas aparecen solas en el filtro, con el nombre que
          les puso el proveedor.
        </p>

        {/* Seis columnas, una con un select: es la tabla más ancha del panel. */}
        <div className="mt-4 overflow-x-auto rounded-xl border border-foreground/10 bg-background">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-foreground/10 text-left text-xs text-foreground/50">
                <th className="px-4 py-3 font-medium">Categoría</th>
                <th className="px-4 py-3 font-medium">Origen</th>
                <th className="px-4 py-3 font-medium">Productos</th>
                <th className="px-4 py-3 font-medium">En el filtro</th>
                <th className="px-4 py-3 font-medium">Unificar con</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {/* Sueltas y unificadas van en UNA sola lista ordenada por
                  nombre. Poner las unificadas al final rompería el orden
                  alfabético, que es lo que permite ver de un vistazo las que
                  se llaman parecido. */}
              {[
                ...view.unassigned,
                ...view.canonicals.flatMap((c) => c.aliases),
              ]
                .sort((a, b) => a.name.localeCompare(b.name, "es"))
                .map((category) => (
                  <ProviderRow
                    key={category.id}
                    category={category}
                    options={canonicalOptions}
                  />
                ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="mt-4 text-xs text-foreground/50">
        {view.totalCount} categorías en total · {view.canonicals.length} propias
        · {view.hiddenCount} ocultas
      </p>
    </div>
  );
}

function ProviderRow({
  category,
  options,
}: {
  category: AdminCategoryRow;
  options: { id: string; name: string }[];
}) {
  return (
    <tr className="border-b border-foreground/5 last:border-0">
      <td className="px-4 py-3">
        <span className="font-medium text-foreground">{category.name}</span>
        <p className="text-xs text-foreground/40">{category.slug}</p>
      </td>
      <td className="px-4 py-3">
        <OriginBadge origin={category.origin} />
      </td>
      <td className="px-4 py-3 text-foreground/70">
        <ProductCount count={category.productCount} />
      </td>
      <td className="px-4 py-3">
        {category.canonicalId ? (
          // Una categoria unificada no tiene estado propio en el filtro: lo
          // que se ofrece es la canonica. Mostrarle un "Visible"/"Oculta"
          // haria pensar que se puede prender sola.
          <span className="text-xs text-foreground/40">
            Bajo {category.canonicalName}
          </span>
        ) : (
          <VisibleBadge visible={category.visible} />
        )}
      </td>
      <td className="px-4 py-3">
        <CategoryUnifySelect
          categoryId={category.id}
          categoryName={category.name}
          canonicalId={category.canonicalId}
          options={options}
        />
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-3">
          <Link
            href={`/catalogo?categoria=${category.slug}`}
            target="_blank"
            className="rounded-lg border border-foreground/15 px-3 py-1.5 text-xs font-medium text-foreground/80 transition-colors hover:border-primary hover:text-primary"
          >
            Ver
          </Link>
          {!category.canonicalId && (
            <ToggleCategoryVisibleButton
              categoryId={category.id}
              categoryName={category.name}
              visible={category.visible}
            />
          )}
        </div>
      </td>
    </tr>
  );
}
