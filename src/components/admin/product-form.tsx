"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { saveProduct } from "@/app/admin/(panel)/productos/actions";

interface VariantRow {
  colorName: string;
  sizeName: string;
  /// String, no number: si esto convirtiera a Number() en cada tecla,
  /// "37.000" tipeado pensando en separador de miles se transforma en 37
  /// ANTES de poder validarlo. Se valida el string crudo recien al enviar.
  stock: string;
  /// Costo de ESTA variante. Mismo criterio de string que el stock: se valida
  /// el texto crudo al enviar, no en cada tecla.
  costPrice: string;
}

const INTEGER_PATTERN = /^\d+$/;
/// Mismo criterio que parsePositiveDecimal del server: sin separadores de
/// miles, maximo dos decimales. La Server Action lo revalida igual.
const DECIMAL_PATTERN = /^\d+(\.\d{1,2})?$/;

function isValidStockInput(value: string): boolean {
  return INTEGER_PATTERN.test(value.trim());
}

interface ExistingImage {
  id: string;
  url: string;
}

export interface ProductFormInitialData {
  id: string;
  name: string;
  description: string | null;
  supplierName: string | null;
  categoryId: string | null;
  minOrderQuantity: number | null;
  images: ExistingImage[];
  variants: {
    colorName: string | null;
    sizeName: string | null;
    stock: number;
    costPrice: number;
  }[];
}

export function ProductForm({
  categories,
  initialProduct,
}: {
  categories: { id: string; name: string }[];
  initialProduct?: ProductFormInitialData;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Controlado (antes era defaultValue) porque ahora tambien alimenta el
  // precio inicial de cada fila de variante nueva.
  //
  // Sale de la PRIMERA variante y ya no del producto, que dejo de tener
  // costo. Para un producto sin variantes cargadas es exactamente el precio de
  // su variante default (la invisible); para uno con variantes, es el valor
  // con el que arrancan las filas nuevas.
  const [precioBase, setPrecioBase] = useState(
    initialProduct?.variants[0] ? String(initialProduct.variants[0].costPrice) : ""
  );

  const [variants, setVariants] = useState<VariantRow[]>(
    initialProduct?.variants.map((v) => ({
      colorName: v.colorName ?? "",
      sizeName: v.sizeName ?? "",
      stock: String(v.stock),
      costPrice: String(v.costPrice),
    })) ?? []
  );
  const [simpleStock, setSimpleStock] = useState(
    initialProduct?.variants.length === 1 &&
      !initialProduct.variants[0].colorName &&
      !initialProduct.variants[0].sizeName
      ? String(initialProduct.variants[0].stock)
      : "0"
  );

  const [existingImages, setExistingImages] = useState<ExistingImage[]>(
    initialProduct?.images ?? []
  );
  const [deleteImageIds, setDeleteImageIds] = useState<string[]>([]);
  // Guardar con imagenes tarda bastante mas: sharp las optimiza antes de
  // subirlas a Blob. Si el boton dice solo "Guardando...", el admin cree que
  // se colgo. Se avisa que hay imagenes en juego.
  const [processingImages, setProcessingImages] = useState(false);

  function addVariantRow() {
    // La fila nueva arranca con el precio base del producto: lo mas comun es
    // que todas las variantes valgan lo mismo, y quien tenga precios distintos
    // solo edita las que difieren.
    setVariants((rows) => [
      ...rows,
      { colorName: "", sizeName: "", stock: "0", costPrice: precioBase },
    ]);
  }

  function updateVariantRow(index: number, patch: Partial<VariantRow>) {
    setVariants((rows) =>
      rows.map((row, i) => (i === index ? { ...row, ...patch } : row))
    );
  }

  function removeVariantRow(index: number) {
    setVariants((rows) => rows.filter((_, i) => i !== index));
  }

  function removeExistingImage(id: string) {
    setExistingImages((images) => images.filter((img) => img.id !== id));
    setDeleteImageIds((ids) => [...ids, id]);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    // onSubmit + preventDefault, no action={fn}: si el servidor rechaza el
    // guardado no queremos perder lo que ya se cargo (mismo motivo que en
    // /cotizar y en equipo/configuracion).
    event.preventDefault();

    setError(null);

    const relevantVariants = variants.filter(
      (v) => v.colorName.trim() || v.sizeName.trim()
    );

    // Validacion client-side (fail fast, sin round trip); la Server Action
    // vuelve a validar esto igual, no confia en que el cliente lo haya hecho.
    if (relevantVariants.length === 0 && !isValidStockInput(simpleStock)) {
      setError(
        "El stock no es válido. Escribí un número entero sin puntos ni comas (ej: 50)."
      );
      return;
    }
    const invalidVariant = relevantVariants.find(
      (v) => !isValidStockInput(v.stock)
    );
    if (invalidVariant) {
      setError(
        `El stock de la variante "${invalidVariant.colorName || invalidVariant.sizeName}" no es válido. Escribí un número entero sin puntos ni comas (ej: 50).`
      );
      return;
    }

    const sinPrecio = relevantVariants.find(
      (v) => !DECIMAL_PATTERN.test(v.costPrice.trim()) || Number(v.costPrice) <= 0
    );
    if (sinPrecio) {
      setError(
        `El costo de la variante "${sinPrecio.colorName || sinPrecio.sizeName}" no es válido. Escribí el número sin puntos de miles (ej: 37000).`
      );
      return;
    }

    const formData = new FormData(event.currentTarget);
    if (initialProduct) formData.set("productId", initialProduct.id);
    formData.set(
      "variants",
      JSON.stringify(
        relevantVariants.map((v) => ({
          colorName: v.colorName.trim() || undefined,
          sizeName: v.sizeName.trim() || undefined,
          stock: Number(v.stock),
          costPrice: Number(v.costPrice),
        }))
      )
    );
    formData.set("deleteImageIds", JSON.stringify(deleteImageIds));

    // El input de archivos es no controlado: la unica forma de saber si hay
    // imagenes nuevas es mirar el FormData ya armado.
    const hasNewImages = formData
      .getAll("newImages")
      .some((entry) => entry instanceof File && entry.size > 0);
    setProcessingImages(hasNewImages);

    startTransition(async () => {
      const result = await saveProduct(formData);
      if (!result.success) {
        setError(result.error ?? "No se pudo guardar.");
        setProcessingImages(false);
        return;
      }
      router.push("/admin/productos");
      router.refresh();
    });
  }

  return (
    // onChange: casi todos los errores de acá señalan un campo concreto ("el
    // stock de la variante X no es válido"). Dejarlos puestos después de que
    // se corrigió ese campo es apuntar a un problema que ya no existe.
    <form
      onSubmit={handleSubmit}
      onChange={() => setError(null)}
      className="flex max-w-2xl flex-col gap-6"
    >
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-foreground">Nombre *</label>
        <input
          type="text"
          name="name"
          required
          defaultValue={initialProduct?.name}
          className="rounded-lg border border-foreground/15 px-4 py-2.5 text-sm outline-none focus:border-primary"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-foreground">
          Descripción
        </label>
        <textarea
          name="description"
          rows={4}
          defaultValue={initialProduct?.description ?? ""}
          className="rounded-lg border border-foreground/15 px-4 py-2.5 text-sm outline-none focus:border-primary"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-foreground">
            Precio base (costo) *
          </label>
          <input
            type="number"
            name="costPrice"
            step="0.01"
            min="0.01"
            placeholder="37000"
            required
            value={precioBase}
            onChange={(e) => setPrecioBase(e.target.value)}
            className="rounded-lg border border-foreground/15 px-4 py-2.5 text-sm outline-none focus:border-primary"
          />
          <p className="text-xs text-foreground/50">
            Sin puntos de miles: escribí 37000, no 37.000. Se le aplica el
            margen global del catálogo, igual que a los productos de Zecat.
            Si cargás variantes, cada una puede tener su propio precio y este
            queda como el valor por defecto de las nuevas.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-foreground">
            Proveedor
          </label>
          <input
            type="text"
            name="supplierName"
            defaultValue={initialProduct?.supplierName ?? ""}
            className="rounded-lg border border-foreground/15 px-4 py-2.5 text-sm outline-none focus:border-primary"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-foreground">
          Cantidad mínima
        </label>
        <input
          type="number"
          name="minOrderQuantity"
          min="1"
          step="1"
          placeholder="Sin mínimo"
          defaultValue={initialProduct?.minOrderQuantity ?? ""}
          className="rounded-lg border border-foreground/15 px-4 py-2.5 text-sm outline-none focus:border-primary sm:max-w-[12rem]"
        />
        <p className="text-xs text-foreground/50">
          Mínimo de unidades para poder cotizar este producto. Dejalo vacío si
          no hay mínimo. Se valida sobre el total del producto, no por cada
          combinación de color y talle.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-foreground">
          Categoría
        </label>
        <select
          name="categoryId"
          defaultValue={initialProduct?.categoryId ?? ""}
          className="rounded-lg border border-foreground/15 px-4 py-2.5 text-sm outline-none focus:border-primary"
        >
          <option value="">Sin categoría</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="text-sm font-medium text-foreground">Fotos</label>

        {existingImages.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-3">
            {existingImages.map((image) => (
              <div key={image.id} className="relative">
                <div className="relative h-20 w-20 overflow-hidden rounded-lg bg-foreground/5">
                  <Image
                    src={image.url}
                    alt=""
                    fill
                    sizes="80px"
                    className="object-cover"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeExistingImage(image.id)}
                  className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-primary-dark text-xs text-white"
                  aria-label="Quitar foto"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <input
          type="file"
          name="newImages"
          accept=".png,.jpg,.jpeg,.webp"
          multiple
          className="mt-3 text-sm text-foreground/70 file:mr-4 file:rounded-full file:border-0 file:bg-foreground/5 file:px-4 file:py-2 file:text-sm file:font-medium file:text-foreground hover:file:bg-foreground/10"
        />
        <p className="mt-1 text-xs text-foreground/50">
          Imagen cuadrada, idealmente 1200x1200 px, fondo blanco o neutro. Se
          optimiza automáticamente. PNG, JPG o WEBP, hasta 5 MB. La primera
          foto que subas (si el producto no tiene ninguna todavía) queda como
          foto principal.
        </p>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-foreground">
            Variantes (opcional)
          </label>
          <button
            type="button"
            onClick={addVariantRow}
            className="text-xs font-medium text-primary hover:text-primary-dark"
          >
            + Agregar variante
          </button>
        </div>

        {variants.length === 0 ? (
          <div className="mt-2 flex flex-col gap-1.5">
            <label className="text-xs text-foreground/50">
              Sin variantes: usa un solo stock general.
            </label>
            <input
              type="number"
              name="simpleStock"
              min="0"
              step="1"
              value={simpleStock}
              onChange={(e) => setSimpleStock(e.target.value)}
              className="w-40 rounded-lg border border-foreground/15 px-4 py-2.5 text-sm outline-none focus:border-primary"
            />
          </div>
        ) : (
          <div className="mt-2 flex flex-col gap-2">
            {variants.map((variant, index) => (
              <div key={index} className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Color"
                  value={variant.colorName}
                  onChange={(e) =>
                    updateVariantRow(index, { colorName: e.target.value })
                  }
                  className="w-32 rounded-lg border border-foreground/15 px-3 py-2 text-sm outline-none focus:border-primary"
                />
                <input
                  type="text"
                  placeholder="Talle"
                  value={variant.sizeName}
                  onChange={(e) =>
                    updateVariantRow(index, { sizeName: e.target.value })
                  }
                  className="w-24 rounded-lg border border-foreground/15 px-3 py-2 text-sm outline-none focus:border-primary"
                />
                <input
                  type="number"
                  placeholder="Stock"
                  min="0"
                  step="1"
                  value={variant.stock}
                  onChange={(e) =>
                    updateVariantRow(index, { stock: e.target.value })
                  }
                  className="w-24 rounded-lg border border-foreground/15 px-3 py-2 text-sm outline-none focus:border-primary"
                />
                <input
                  type="number"
                  placeholder="Costo"
                  min="0.01"
                  step="0.01"
                  value={variant.costPrice}
                  onChange={(e) =>
                    updateVariantRow(index, { costPrice: e.target.value })
                  }
                  className="w-28 rounded-lg border border-foreground/15 px-3 py-2 text-sm outline-none focus:border-primary"
                />
                <button
                  type="button"
                  onClick={() => removeVariantRow(index)}
                  className="text-xs font-medium text-foreground/50 hover:text-primary-dark"
                >
                  Quitar
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && (
        <p className="rounded-lg bg-primary-dark/5 px-4 py-3 text-sm text-primary-dark">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="self-start rounded-full bg-primary px-8 py-3 text-sm font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-60"
      >
        {isPending
          ? processingImages
            ? "Procesando imagenes..."
            : "Guardando..."
          : "Guardar"}
      </button>
    </form>
  );
}
