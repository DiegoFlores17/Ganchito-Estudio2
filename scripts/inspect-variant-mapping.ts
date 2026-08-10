import "dotenv/config";
import { fetchGenericProductDetail } from "../src/lib/zecat/client";
import { flattenVariants, mapVariantAttributes } from "../src/lib/zecat/normalize";

// Valida el mapeo dinamico de color/talle/material contra la API real,
// SIN tocar la base. Un producto de cada tipo para confirmar que el
// atributo cae en el campo correcto sin importar el orden que use Zecat.
const ZECAT_IDS = [
  { id: "4787", label: "Chomba Planet (indumentaria)" },
  { id: "3868", label: "Mochila PIODA (mochila)" },
  { id: "3791", label: "Termo AVANZA 0,5 Lt. (drinkware)" },
];

async function main() {
  for (const { id, label } of ZECAT_IDS) {
    console.log(`\n=== ${label} — zecatId ${id} ===`);
    const detail = await fetchGenericProductDetail(id);
    const variants = flattenVariants(detail.variants);

    for (const variant of variants.slice(0, 4)) {
      const raw = variant as unknown as Record<string, unknown>;
      const mapped = mapVariantAttributes(variant);
      console.log(`  sku ${variant.sku}`);
      console.log(
        `    attribute_one=${JSON.stringify((raw.attribute_one as { description?: string } | null)?.description)} elementDescription1=${JSON.stringify(variant.elementDescription1)}`
      );
      console.log(
        `    attribute_two=${JSON.stringify((raw.attribute_two as { description?: string } | null)?.description)} elementDescription2=${JSON.stringify(variant.elementDescription2)}`
      );
      console.log(
        `    attribute_three=${JSON.stringify((raw.attribute_three as { description?: string } | null)?.description)} elementDescription3=${JSON.stringify(variant.elementDescription3)}`
      );
      console.log(
        `    -> mapeado: color=${JSON.stringify(mapped.colorName)} size=${JSON.stringify(mapped.sizeName)} material=${JSON.stringify(mapped.materialName)}`
      );
    }
  }
}

main().catch((error) => {
  console.error("Fallo:", error);
  process.exitCode = 1;
});
