/// Asignación inicial de `menuGroup`, una sola vez.
///
/// Transcribe una decisión YA TOMADA: los grupos y su contenido los definió el
/// cliente, no los infiere este script. Eso es lo que lo distingue del mapeo de
/// canónicas, que se hace a mano desde el panel justamente porque ahí sí habría
/// que adivinar (ver CLAUDE.md, "El mapeo se hace a mano desde el panel").
///
/// Dos propiedades que lo hacen seguro:
///
/// 1. ABORTA SIN ESCRIBIR NADA si alguna categoría de la lista no aparece en la
///    base con ese nombre exacto. Asignar 13 de 14 en silencio es peor que no
///    correrlo: el menú saldría incompleto y nadie sabría cuál falta.
///
/// 2. Sólo escribe donde `menuGroup` está en null. Correrlo dos veces no pisa
///    nada de lo que el cliente haya cambiado después desde el panel.
///
/// Uso:  npx tsx --env-file=.env scripts/asignar-grupos-menu.ts
/// Producción: DATABASE_URL=... adelante del comando (ver HANDOFF, "Regla de
/// entornos").
import { prisma } from "../src/lib/prisma";
import { normalizarMenuGroup } from "../src/lib/admin-categories";

/// La lista, tal cual la definió el cliente. Las que no figuran acá quedan en
/// null a propósito y caen en la fila secundaria del menú: Salud y Belleza,
/// Packaging, Herramientas, Hydra Go, Sublimables, Próximos Arribos, 2026 Agro.
const GRUPOS: Record<string, string[]> = {
  "Hogar y bebidas": ["Hogar y Tiempo Libre", "Drinkware", "Eco y Sustentables"],
  "Bolsos y viaje": ["Bolsos y Mochilas", "Viajes", "Coolers y luncheras"],
  "Escritorio y oficina": [
    "Escritura",
    "Tecnología",
    "Oficina y Negocios",
    "Cuadernos",
  ],
  Indumentaria: ["Apparel", "Llaveros", "Paraguas", "Gorros"],
};

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  const destino = url.includes("neon.tech") ? "NEON (PRODUCCIÓN)" : "LOCAL";
  console.log(`Escribe en: ${destino}\n`);

  const esperadas = Object.values(GRUPOS).flat();

  // SOLO CANÓNICAS (canonicalId: null). Los grupos son para el menú, y el menú
  // muestra únicamente canónicas: asignarle grupo a un alias no tendría ningún
  // efecto visible, y encima haría que "Escritura" apareciera ambigua —
  // existen la de Zecat, la de CDO y la propia que las unifica.
  const enBase = await prisma.category.findMany({
    where: { canonicalId: null },
    select: { id: true, name: true, menuGroup: true, visible: true },
  });

  // El match es por nombre exacto salvo por los espacios de los extremos: en
  // la base hay categorías como "Apparel " con un espacio final que viene del
  // proveedor. Eso es un typo de ellos, no otra categoría — pero cuando pasa
  // se avisa, para que no sea un ajuste silencioso.
  const porNombre = new Map<string, typeof enBase>();
  for (const c of enBase) {
    const clave = c.name.trim();
    porNombre.set(clave, [...(porNombre.get(clave) ?? []), c]);
  }

  const faltantes = esperadas.filter((n) => !porNombre.has(n));
  const ambiguas = [...porNombre.entries()].filter(([, cs]) => cs.length > 1);

  if (faltantes.length > 0 || ambiguas.length > 0) {
    console.error("=".repeat(70));
    console.error("  ABORTADO — NO SE ESCRIBIÓ NADA");
    console.error("=".repeat(70));
    if (faltantes.length > 0) {
      console.error(`\n  ${faltantes.length} categoría(s) de la lista NO existen con ese nombre exacto:\n`);
      for (const n of faltantes) console.error(`    ✗ "${n}"`);
      console.error(
        `\n  Puede ser que el proveedor la haya renombrado, o que el nombre de la`
      );
      console.error(`  lista tenga una diferencia de tipeo o de acentuación.`);
      console.error(`  Nombres parecidos que SÍ están en la base:\n`);
      const todas = await prisma.category.findMany({
        select: { name: true },
        orderBy: { name: "asc" },
      });
      for (const n of faltantes) {
        const pista = todas
          .map((c) => c.name)
          .filter((real) => normalizarMenuGroup(real).includes(normalizarMenuGroup(n).slice(0, 6)))
          .slice(0, 3);
        console.error(`    "${n}" -> ${pista.length ? pista.map((p) => `"${p}"`).join(", ") : "(ninguno parecido)"}`);
      }
    }
    if (ambiguas.length > 0) {
      console.error(`\n  ${ambiguas.length} nombre(s) aparecen MÁS DE UNA VEZ entre las canónicas:\n`);
      for (const [n, cs] of ambiguas) console.error(`    ✗ "${n}" — ${cs.length} categorías`);
      console.error(`\n  Suele significar que esas homónimas todavía NO están unificadas:`);
      console.error(`  unificalas primero desde el panel y volvé a correr esto, o`);
      console.error(`  asignales el grupo a mano.`);
    }
    console.error("\n" + "=".repeat(70));
    process.exit(1);
  }

  // Recién acá se escribe: la lista entera resolvió sin ambigüedad.
  let asignadas = 0;
  const yaTenian: string[] = [];
  for (const [grupo, nombres] of Object.entries(GRUPOS)) {
    for (const nombre of nombres) {
      const cat = porNombre.get(nombre)![0];
      if (cat.name !== nombre) {
        console.log(`  ! "${cat.name}" tiene espacios de más en el nombre (se matcheó igual)`);
      }
      if (cat.menuGroup !== null) {
        yaTenian.push(`"${cat.name}" ya estaba en "${cat.menuGroup}"`);
        continue;
      }
      await prisma.category.update({
        where: { id: cat.id },
        data: { menuGroup: grupo },
      });
      asignadas++;
      console.log(`  ✓ ${nombre.padEnd(24)} -> ${grupo}${cat.visible ? "" : "   (OJO: está OCULTA, no va a aparecer en el menú)"}`);
    }
  }

  console.log(`\n  Asignadas: ${asignadas} de ${esperadas.length}`);
  if (yaTenian.length > 0) {
    console.log(`  Sin tocar (ya tenían grupo):`);
    for (const l of yaTenian) console.log(`    · ${l}`);
  }
}

main().finally(() => prisma.$disconnect());
