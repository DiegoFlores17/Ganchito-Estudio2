import { Suspense } from "react";
import Image from "next/image";
import Link from "next/link";
import { ProductCard } from "@/components/catalog/product-card";
import { Skeleton } from "@/components/skeleton";
import { getFeaturedProducts, hasAvailableStock } from "@/lib/catalog";
import { WHATSAPP_URL } from "@/lib/contact";
import { getHomeCategoryShowcase, HOME_CATEGORY_COUNT } from "@/lib/home";
import { computeSellPrice, getPricingConfig } from "@/lib/pricing";

/// La home se sirve cacheada, pero NO indefinidamente.
///
/// Muestra precios (destacados), y los precios cambian por dos caminos muy
/// distintos:
/// - Desde el panel (margen global, alta/baja de productos manuales): son
///   Server Actions, asi que invalidan la home al instante con
///   revalidatePath("/"). Ese es el camino preciso y sin costo.
/// - Desde el sync de Zecat: corre como script suelto, FUERA del runtime de
///   Next, asi que no puede llamar a revalidatePath. Para ese caso, y solo
///   para ese, hace falta esta ventana de tiempo.
///
/// 300 y no un valor mas alto porque lo que se desfasa son precios: cinco
/// minutos es comercialmente irrelevante y sirve practicamente todo el
/// trafico desde cache igual. Ojo: el valor tiene que ser un literal — Next
/// lo analiza estaticamente y `60 * 5` no es valido.
///
/// Si en algun momento el sync pasa a Vercel Cron, conviene darle un endpoint
/// de revalidacion con secreto y bajar esto a false (ver PENDIENTES).
export const revalidate = 300;

const FEATURED_PRODUCTS_COUNT = 8;

const PROCESS_STEPS = [
  {
    number: "01",
    title: "Explora",
    description:
      "Recorre el catalogo y elegi los productos que representan a tu empresa.",
  },
  {
    number: "02",
    title: "Personaliza",
    description:
      "Suma tu logo, elegi color, talle y las cantidades que necesitas.",
  },
  {
    number: "03",
    title: "Revisamos",
    description:
      "Te mandamos un boceto y el precio final antes de que confirmes nada.",
  },
  {
    number: "04",
    title: "Listo",
    description: "Con tu aprobacion, coordinamos produccion y entrega.",
  },
];

/// La home NO usa loading.tsx de ruta a proposito.
///
/// Tres de sus cinco secciones (hero, "Como funciona" y el CTA final) son
/// texto fijo que no toca la base. Un loading.tsx las taparia con gris sin
/// motivo, y el cliente veria la pantalla entera en skeleton cuando en
/// realidad casi toda estaba lista. Con Suspense por seccion, el shell
/// aparece instantaneo y solo esperan las dos partes que consultan datos.
export default function HomePage() {
  return (
    <div>
      <section className="bg-primary-dark">
        <div className="mx-auto max-w-6xl px-6 py-24 sm:py-32">
          <h1 className="max-w-2xl text-5xl font-black tracking-tight text-white sm:text-6xl">
            Merch corporativo con el logo de tu empresa
          </h1>
          <p className="mt-6 max-w-xl text-lg text-white/70">
            Elegis los productos del catalogo, nosotros los personalizamos con
            tu logo y te mandamos la cotizacion. Asi de simple.
          </p>
          <div className="mt-10 flex flex-wrap gap-4">
            <Link
              href="/catalogo"
              className="rounded-full bg-accent px-7 py-3.5 text-sm font-medium text-primary-dark transition-colors hover:bg-accent-hover"
            >
              Ver catalogo
            </Link>
            <a
              href={WHATSAPP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-white/30 px-7 py-3.5 text-sm font-medium text-white transition-colors hover:border-white hover:bg-white/5"
            >
              Contacto
            </a>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-20 sm:py-24">
        <h2 className="text-3xl font-black tracking-tight text-foreground sm:text-4xl">
          Explora por categoria
        </h2>
        <Suspense fallback={<CategoryShowcaseSkeleton />}>
          <CategoryShowcase />
        </Suspense>
      </section>

      <section className="border-t border-foreground/[0.06] bg-foreground/[0.02]">
        <div className="mx-auto max-w-6xl px-6 py-20 sm:py-24">
          <h2 className="text-3xl font-black tracking-tight text-foreground sm:text-4xl">
            Como funciona
          </h2>
          <div className="mt-12 grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-4">
            {PROCESS_STEPS.map((step) => (
              <div key={step.number}>
                <p className="text-4xl font-black text-primary-light">
                  {step.number}
                </p>
                <p className="mt-3 text-lg font-medium text-foreground">
                  {step.title}
                </p>
                <p className="mt-2 text-sm text-foreground/60">
                  {step.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-20 sm:py-24">
        <h2 className="text-3xl font-black tracking-tight text-foreground sm:text-4xl">
          Productos destacados
        </h2>
        <Suspense fallback={<FeaturedProductsSkeleton />}>
          <FeaturedProducts />
        </Suspense>
        <div className="mt-14 flex justify-center">
          <Link
            href="/catalogo"
            className="rounded-full border border-foreground/15 px-7 py-3 text-sm font-medium text-foreground transition-colors hover:border-primary hover:text-primary"
          >
            Ver todo el catalogo
          </Link>
        </div>
      </section>

      <section className="bg-primary">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-6 py-20 sm:items-center sm:py-24 sm:text-center">
          <h2 className="max-w-2xl text-3xl font-black tracking-tight text-white sm:text-4xl">
            Listo para vestir tu marca?
          </h2>
          <p className="max-w-xl text-white/75">
            Armamos tu pedido, te mandamos el boceto y el precio final antes
            de que confirmes nada.
          </p>
          <Link
            href="/catalogo"
            className="rounded-full bg-accent px-7 py-3.5 text-sm font-medium text-primary-dark transition-colors hover:bg-accent-hover"
          >
            Ver catalogo
          </Link>
        </div>
      </section>
    </div>
  );
}

const CATEGORY_GRID_CLASSES =
  "mt-10 grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3";
const PRODUCT_GRID_CLASSES =
  "mt-10 grid grid-cols-2 gap-x-6 gap-y-12 sm:grid-cols-3 lg:grid-cols-4";

async function CategoryShowcase() {
  const categories = await getHomeCategoryShowcase();

  return (
    <div className={CATEGORY_GRID_CLASSES}>
      {categories.map((category) => (
        <Link
          key={category.slug}
          href={`/catalogo?categoria=${category.slug}`}
          className="group flex flex-col gap-4"
        >
          <div className="relative aspect-[4/3] overflow-hidden rounded-xl border border-foreground/[0.06] bg-foreground/[0.03]">
            {category.imageUrl && (
              <Image
                src={category.imageUrl}
                alt={category.name}
                fill
                sizes="(min-width: 1024px) 30vw, (min-width: 640px) 45vw, 90vw"
                className="object-cover transition-transform duration-300 group-hover:scale-[1.04]"
              />
            )}
          </div>
          <p className="text-lg font-medium text-foreground transition-colors group-hover:text-primary-light">
            {category.name}
          </p>
        </Link>
      ))}
    </div>
  );
}

/// La cantidad de placeholders sale de las mismas constantes que usan las
/// secciones reales, no de un numero a mano: asi el contenido entra en el
/// mismo lugar y la pagina no salta, aunque cambien.
function CategoryShowcaseSkeleton() {
  return (
    <div className={CATEGORY_GRID_CLASSES}>
      {Array.from({ length: HOME_CATEGORY_COUNT }).map((_, index) => (
        <div key={index} className="flex flex-col gap-4">
          <Skeleton className="aspect-[4/3] w-full rounded-xl" />
          <Skeleton className="h-6 w-40" />
        </div>
      ))}
    </div>
  );
}

async function FeaturedProducts() {
  const [featuredProducts, pricingConfig] = await Promise.all([
    getFeaturedProducts(FEATURED_PRODUCTS_COUNT),
    getPricingConfig(),
  ]);

  return (
    <div className={PRODUCT_GRID_CLASSES}>
      {featuredProducts.map((product) => (
        <ProductCard
          key={product.id}
          product={product}
          sellPrice={computeSellPrice(
            product.costPrice,
            pricingConfig.defaultMarginPercent
          )}
          inStock={hasAvailableStock(product.variants)}
        />
      ))}
    </div>
  );
}

function FeaturedProductsSkeleton() {
  return (
    <div className={PRODUCT_GRID_CLASSES}>
      {Array.from({ length: FEATURED_PRODUCTS_COUNT }).map((_, index) => (
        <div key={index} className="flex flex-col gap-4">
          <Skeleton className="aspect-square w-full rounded-xl" />
          <div>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="mt-2 h-4 w-2/3" />
            <Skeleton className="mt-3 h-5 w-28" />
          </div>
        </div>
      ))}
    </div>
  );
}
