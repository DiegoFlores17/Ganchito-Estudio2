// Verificacion de las leyendas de precio (que incluye y que no incluye).
// Es una funcion pura: no toca la base ni la red.
//
//   npx tsx scripts/audit-verify-leyendas.ts
import { leyendasDePrecio, LEYENDAS_PRECIO } from "../src/lib/leyendas-precio";

let fallos = 0;
function check(nombre: string, ok: boolean) {
  if (!ok) fallos++;
  console.log(`${ok ? "OK   " : "FALLA"} ${nombre}`);
}

const con = leyendasDePrecio({ personalizable: true });
const sin = leyendasDePrecio({ personalizable: false });

check("personalizable: la card avisa que personalizacion y envio se cotizan aparte", con.card === "Personalización y envío se cotizan aparte");
check("sin personalizacion: la card dice que se entrega sin personalizar", sin.card === "Se entrega sin personalizar · el envío se cotiza aparte");
check("personalizable: la ficha cotiza personalizacion y envio aparte", con.ficha === "La personalización y el envío se cotizan aparte.");
check("sin personalizacion: la ficha aclara que no se personaliza", sin.ficha === "Producto que se entrega sin personalizar. El envío se cotiza aparte.");
check("las leyendas de total son las mismas para ambos casos", con.totalCotizar === sin.totalCotizar && con.totalMensaje === sin.totalMensaje);
check("el sufijo del total en mensajes es el acordado", LEYENDAS_PRECIO.totalMensaje === "(+ personalización y envío)");
check("ninguna leyenda queda vacia", Object.values(LEYENDAS_PRECIO).every((v) => typeof v === "string" ? v.length > 0 : Object.values(v).every((s) => s.length > 0)));

if (fallos > 0) {
  console.error(`\n${fallos} check(s) fallaron`);
  process.exit(1);
}
console.log("\nTodo OK");
