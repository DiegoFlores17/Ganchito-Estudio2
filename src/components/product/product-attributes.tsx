import type { Prisma } from "@prisma/client";
import { formatAttributeName } from "@/lib/format";

type ProductAttribute = Prisma.ProductAttributeGetPayload<Record<string, never>>;

/// Caracteristicas del producto: certificaciones, materiales y aptitudes de
/// uso ("Reciclable", "BPA Free", "Apto lavavajillas").
///
/// **Va en un bloque propio y no dentro de Personalización**, aunque este
/// pegado. "Personalización" contesta *cómo le pongo mi logo*; esto contesta
/// *qué es este producto*. Meter "Reciclable" bajo ese título lo haria leer
/// como una opcion de impresion.
///
/// **Sin los iconos del proveedor, a proposito.** CDO manda la imagen de cada
/// uno, pero vienen con sus colores y su tipografia y chocarian con la
/// identidad de Ganchito (ver DISENO.md). El dato es el nombre; el icono es
/// diseno ajeno.
///
/// **Solo en la ficha, no en las cards del catalogo.** En una grilla de 855
/// productos, sumar chips a cada card la convierte en un mar de etiquetas que
/// compite con la foto y el precio. En el catalogo el cliente escanea; estos
/// datos importan cuando ya esta evaluando un producto puntual.
export function ProductAttributes({
  attributes,
}: {
  attributes: ProductAttribute[];
}) {
  // Nada de secciones vacias: hoy los productos de Zecat no tienen atributos
  // (su API no los expone como dato, ver HANDOFF), asi que este bloque
  // simplemente no existe en esas fichas.
  if (attributes.length === 0) return null;

  return (
    <div className="flex flex-col gap-3 border-t border-foreground/10 pt-6">
      <p className="text-sm font-medium text-foreground">Características</p>
      <div className="flex flex-wrap gap-2">
        {attributes.map((attribute) => (
          <span
            key={attribute.id}
            // Mismo chip que las tecnicas de impresion, con el violeta de
            // marca en vez del gris: son del mismo tipo de dato y conviene
            // que se lean como una familia, pero estos son atributos del
            // producto y merecen algo mas de presencia.
            className="rounded-full bg-primary/[0.07] px-3 py-1 text-xs text-primary"
          >
            {formatAttributeName(attribute.name)}
          </span>
        ))}
      </div>
    </div>
  );
}
