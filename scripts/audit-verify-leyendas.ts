// Verificacion de las leyendas de precio (que incluye y que no incluye).
// Es una funcion pura: no toca la base ni la red.
//
//   npx tsx scripts/audit-verify-leyendas.ts
import {
  impresionEnTotal,
  leyendaTotalCotizar,
  leyendaTotalMensaje,
  leyendasDePrecio,
  LEYENDAS_PRECIO,
} from "../src/lib/leyendas-precio";

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
// Leyenda del total segun el pedido (tanda 4b).
check("sin personalizacion elegida y con productos sin precio: personalizacion y envio aparte",
  leyendaTotalCotizar(impresionEnTotal({ conImpresion: 0, sinPrecio: 1 })) === LEYENDAS_PRECIO.totalCotizar);
check("todo con personalizacion estimada: solo el envio aparte",
  leyendaTotalCotizar(impresionEnTotal({ conImpresion: 2, sinPrecio: 0 })) === LEYENDAS_PRECIO.totalCotizarConImpresion);
check("con personalizacion + productos sin precio (CDO): se mantiene la frase de parcial",
  leyendaTotalCotizar(impresionEnTotal({ conImpresion: 1, sinPrecio: 1 })) === LEYENDAS_PRECIO.totalCotizarImpresionParcial);
check("solo 'Sin personalizar' elegido a proposito: solo el envio aparte, sin prometer personalizacion aparte",
  leyendaTotalCotizar(impresionEnTotal({ conImpresion: 0, sinPrecio: 0 })) === LEYENDAS_PRECIO.totalCotizarSoloEnvio &&
  !/personalizaci/i.test(LEYENDAS_PRECIO.totalCotizarSoloEnvio));
check("con personalizacion + 'Sin personalizar' elegido: no dice que el resto se cotiza aparte",
  leyendaTotalCotizar(impresionEnTotal({ conImpresion: 1, sinPrecio: 0 })) === LEYENDAS_PRECIO.totalCotizarConImpresion);
check("sufijos del mensaje por caso",
  leyendaTotalMensaje("soloEnvio") === "(+ envío)" &&
  leyendaTotalMensaje("toda") === LEYENDAS_PRECIO.totalMensajeConImpresion &&
  leyendaTotalMensaje("parcial") === LEYENDAS_PRECIO.totalMensajeImpresionParcial &&
  leyendaTotalMensaje("ninguna") === LEYENDAS_PRECIO.totalMensaje);
check("el adicional no menciona el umbral ni promete personalizacion gratis",
  LEYENDAS_PRECIO.adicionalCantidadChica === "Adicional por cantidad chica");
// Ficha con niveles (tanda 4c).
const niv = leyendasDePrecio({ personalizable: true, conNiveles: true });
check("con niveles: la ficha usa la rama de personalizacion estimada", niv.ficha === "Precio sin logo. Abajo, con personalización estimada · el envío se cotiza aparte.");
check("con niveles: el pie de impresion dice estimado y se confirma al ver el logo", niv.impresion === LEYENDAS_PRECIO.impresionConNiveles && niv.impresion.includes("lo confirmamos al ver tu logo"));
check("con niveles: la card del catalogo no cambia", niv.card === con.card);
check("sin niveles (CDO): la ficha y el pie de siempre", con.ficha === LEYENDAS_PRECIO.ficha.personalizable && con.impresion === LEYENDAS_PRECIO.impresion);
check("sin personalizar elegido en /cotizar: nota corta", LEYENDAS_PRECIO.ficha.sinPersonalizarElegido.startsWith("Elegiste sin personalizar en tu cotización"));
check("ninguna leyenda queda vacia", Object.values(LEYENDAS_PRECIO).every((v) => typeof v === "string" ? v.length > 0 : Object.values(v).every((s) => s.length > 0)));

if (fallos > 0) {
  console.error(`\n${fallos} check(s) fallaron`);
  process.exit(1);
}
console.log("\nTodo OK");
