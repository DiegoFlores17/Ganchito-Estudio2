// Zecat simulado para los scripts de verificacion: un servidor HTTP local de
// verdad (no un fetch interceptado), asi lo puede usar tambien un proceso
// hijo — el que se mata a mitad de un tick para probar el retome.
//
// Responde las dos rutas que usa el conector: el listado completo
// (/generic_product?page=1&limit=…) y el detalle (/generic_product/{id}).
import http from "node:http";
import type { AddressInfo } from "node:net";

export type Comportamiento = "ok" | "vacio" | "404" | "500";

export interface EstadoFalso {
  /// Ids que devuelve el listado.
  listado: string[];
  /// Como responde el detalle de cada id (default "ok").
  detalle: Map<string, Comportamiento>;
  /// Demora de cada respuesta de detalle, en ms (para que un tick no
  /// termine la corrida de una).
  demoraDetalleMs: number;
  /// El listado responde 500 (la API "caida").
  listadoCaido: boolean;
  /// Contadores, para verificar que no se repiten pedidos.
  pedidosDetalle: Map<string, number>;
}

export function detalleFalso(id: string, variantes: boolean) {
  return {
    id,
    name: `Producto C ${id}`,
    description: "Prueba etapa C",
    price: 1000,
    published: true,
    images: [],
    variants: {
      colors: variantes
        ? {
            "0": [
              {
                sku: `${id}-v`,
                elementDescription1: "Negro",
                attribute_one: { description: "Color" },
                stock: "10",
                reservedStock: "0",
                active: true,
                discount_partner: 30,
              },
            ],
          }
        : {},
      sizes: {},
    },
  };
}

export async function levantarZecatFalso(estado: EstadoFalso) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (url.pathname.endsWith("/generic_product")) {
      if (estado.listadoCaido) return json(500, { message: "caido" });
      const ids = estado.listado;
      return json(200, {
        count: ids.length,
        total_pages: 1,
        generic_products: ids.map((id) => ({ id })),
      });
    }

    const m = url.pathname.match(/\/generic_product\/(.+)$/);
    if (m) {
      const id = decodeURIComponent(m[1]);
      estado.pedidosDetalle.set(id, (estado.pedidosDetalle.get(id) ?? 0) + 1);
      if (estado.demoraDetalleMs) await new Promise((r) => setTimeout(r, estado.demoraDetalleMs));
      const c = estado.detalle.get(id) ?? "ok";
      if (c === "404") return json(404, { message: "not found" });
      if (c === "500") return json(500, { message: "error" });
      return json(200, { generic_product: detalleFalso(id, c === "ok") });
    }
    return json(404, { message: "ruta desconocida" });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/v1`,
    cerrar: () => new Promise<void>((r) => server.close(() => r())),
  };
}
