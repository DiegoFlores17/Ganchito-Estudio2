import { ProductOrigin } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  confirmarAusencia,
  fetchGenericProductDetail,
  listarIdsCongelados,
  TIMEOUT_DETALLE_MS,
  ZecatHttpError,
  type Confirmacion,
} from "@/lib/zecat/client";
import { flattenVariants, ZecatPricingError } from "@/lib/zecat/normalize";
import { syncProduct } from "@/lib/zecat/sync";
import type { ZecatGenericProduct } from "@/lib/zecat/types";
import { CdoHttpError, fetchProductByCode, listarCatalogoCompleto } from "@/lib/cdo/client";
import { candidateImageUrls } from "@/lib/cdo/normalize";
import { medirConCache } from "@/lib/cdo/imagenes";
import {
  syncCdoProduct,
  tieneVariantesVendibles,
  vaciosQueSeApagarian,
  type CdoSyncSummary,
} from "@/lib/cdo/sync";
import type { CdoProduct } from "@/lib/cdo/types";

/// Resumen descartable para syncCdoProduct (lo llenaba la corrida entera de
/// la consola vieja; en el motor se loguea producto por producto).
function resumenCdoVacio(): CdoSyncSummary {
  return {
    total: 0,
    created: 0,
    updated: 0,
    failed: 0,
    sinImagen: [],
    skuSintetico: 0,
    variantesSinPrecio: [],
    iconosDesconocidos: [],
    portadas: { ok: 0, deformes: 0, chicas: 0, rotas: 0 },
    variantesDesactivadas: 0,
    sinVariantes: [],
    errors: [],
  };
}

/// Lo que el motor del sync (lib/sync/motor.ts) necesita de un proveedor.
/// El motor no sabe nada de Zecat ni de CDO: recorre la lista congelada,
/// corta por tiempo, toma el lease, detecta ausentes y avisa — y le pide al
/// conector solo estas cinco cosas. CDO se monta en la etapa E
/// implementando esta misma interfaz.
export interface Conector {
  provider: ProductOrigin;
  nombre: string;
  /// true si cargar un producto no cuesta nada (ya esta en memoria, como en
  /// CDO). El motor puede entonces cortar el tick a mitad de una tanda sin
  /// tirar trabajo. En Zecat cargar es un request por producto: se corta
  /// solo entre tandas, para no volver a pedir detalles ya pedidos.
  cargaGratis: boolean;
  /// La lista congelada: todos los ids del catalogo y el total que la API
  /// declara. Tiene que cerrar (ids distintos == total) o tirar.
  listar(): Promise<{ ids: string[]; total: number }>;
  /// El producto de un id. "ausente" = el proveedor dice que no existe (un
  /// 404 a mitad de corrida): NO es un fallo, es un ausente.
  cargar(id: string): Promise<Carga>;
  /// Si el producto vino sin ninguna variante vendible. Lo usa la guarda de
  /// "tanda entera vacia" del motor, ANTES de escribir.
  sinVariantes(producto: unknown): boolean;
  sincronizar(producto: unknown, contexto: ContextoSincronizar): Promise<ResultadoSincronizar>;
  confirmarAusente(id: string): Promise<{ resultado: Confirmacion; motivo: string }>;
}

export type Carga =
  | { tipo: "ok"; producto: unknown }
  | { tipo: "ausente" }
  | { tipo: "error"; mensaje: string };

export interface ResultadoSincronizar {
  /// "pausado": no se pudo calcular el costo y el producto, que existia,
  /// quedo pausado (mejor faltante que con un precio inventado).
  resultado: "creado" | "actualizado" | "pausado";
  monedaSospechosa: boolean;
  /// El producto estaba activo y se quedo sin foto usable: "apagado" si se
  /// apago, "retenido" si conservo su estado por el tope (ver motor.ts).
  sinFoto?: "apagado" | "retenido";
}

/// Lo que el motor le dice al conector sobre la corrida en curso.
export interface ContextoSincronizar {
  /// false cuando la corrida ya apago por "sin foto" tantos productos como
  /// el umbral de seguridad: los siguientes conservan su estado.
  puedeApagarSinFoto: boolean;
}

const zecat: Conector = {
  provider: ProductOrigin.ZECAT,
  nombre: "Zecat",
  cargaGratis: false,
  listar: listarIdsCongelados,
  async cargar(id) {
    try {
      // Sin reintentos: un detalle que falla queda como fallido de esta
      // corrida (y "visto": no cuenta como ausente) y se reintenta en la
      // proxima. Reintentar con 15 s de timeout se come el tick.
      const producto = await fetchGenericProductDetail(id, {
        timeoutMs: TIMEOUT_DETALLE_MS,
        reintentos: 0,
      });
      return { tipo: "ok", producto };
    } catch (error) {
      if (error instanceof ZecatHttpError && error.status === 404) {
        return { tipo: "ausente" };
      }
      return {
        tipo: "error",
        mensaje: error instanceof Error ? error.message : String(error),
      };
    }
  },
  sinVariantes(producto) {
    const p = producto as ZecatGenericProduct;
    return !flattenVariants(p.variants).some((v) => v.active ?? true);
  },
  async sincronizar(producto) {
    const p = producto as ZecatGenericProduct;
    // El campo currency de Zecat no es confiable: se loguea y se ignora (ver
    // CLAUDE.md, "Currency").
    const monedaSospechosa = p.currency === "USD";
    if (monedaSospechosa) {
      console.warn(
        `[zecat-sync] currency="USD" sospechoso en producto ${p.id} (${p.name}) — se guarda como ARS sin convertir.`
      );
    }
    try {
      const r = await syncProduct(p);
      if (r.variantesDesactivadas > 0) {
        console.warn(
          `[zecat-sync] Producto ${p.id}: ${r.variantesDesactivadas} variante(s) desactivada(s), ya no vienen en el detalle.`
        );
      }
      if (r.sinVariantes) {
        console.warn(
          `[zecat-sync] Producto ${p.id} (${p.name}) vino SIN variantes: queda inactivo hasta que vuelvan.`
        );
      }
      return { resultado: r.outcome === "created" ? "creado" : "actualizado", monedaSospechosa };
    } catch (error) {
      // Sin costo calculable NO puede quedar a la venta el precio viejo: si
      // el producto ya existia, se pausa. "Un producto faltante y visible es
      // preferible a uno con precio inflado que nadie detecta."
      if (error instanceof ZecatPricingError) {
        const pausado = await prisma.product.updateMany({
          where: { zecatId: String(p.id), active: true },
          data: { active: false },
        });
        if (pausado.count > 0) {
          console.warn(
            `[zecat-sync] Producto ${p.id} PAUSADO: existia con el costo viejo y no se pudo recalcular.`
          );
          return { resultado: "pausado", monedaSospechosa };
        }
      }
      throw error;
    }
  },
  confirmarAusente: confirmarAusencia,
};

// --- CDO Promocionales -----------------------------------------------------

/// El listado de CDO trae el producto ENTERO (identico al detalle), asi que
/// "cargar" no pide nada por producto: usa el catalogo bajado en este tick.
/// Se guarda unos minutos en memoria: en el servidor cada tick suele ser
/// otra instancia (lo baja de nuevo, ~4 requests); en la consola, ticks
/// seguidos lo reusan.
const CATALOGO_CDO_VIVE_MS = 2 * 60 * 1000;
let catalogoCdo: { hasta: number; porId: Map<string, CdoProduct> } | null = null;
/// La descarga en curso, compartida: el motor llama a cargar() de a 5 en
/// paralelo, y sin esto cada llamada bajaba el catalogo entero por su lado.
let descargandoCdo: Promise<Map<string, CdoProduct>> | null = null;

async function catalogoCdoVigente(): Promise<Map<string, CdoProduct>> {
  if (catalogoCdo && catalogoCdo.hasta > Date.now()) return catalogoCdo.porId;
  descargandoCdo ??= listarCatalogoCompleto()
    .then(({ productos }) => {
      const porId = new Map(productos.map((p) => [String(p.id), p]));
      catalogoCdo = { hasta: Date.now() + CATALOGO_CDO_VIVE_MS, porId };
      return porId;
    })
    .finally(() => {
      descargandoCdo = null;
    });
  return descargandoCdo;
}

/// Forma esperable de un code de CDO (los reales: "BP161", "T680+T720F").
/// Un 404 sobre un code con otra forma no prueba nada: hay codes basura
/// (uno fue literalmente "25% de descuento!!!!!") que la ruta del detalle
/// puede no resolver aunque el producto exista.
const CODE_CDO_CONFIABLE = /^[A-Za-z0-9._+-]+$/;

/// Guarda de entorno: en el deploy de PRODUCCION, una URL de CDO que parece
/// de pruebas no corre. Sincronizar el catalogo de pruebas contra la base de
/// produccion dejaria ausentes los productos reales (y metería los de prueba).
function verificarEntornoCdo() {
  const url = process.env.CDO_API_URL ?? "";
  if (process.env.VERCEL_ENV === "production" && /dev\.yellowspot|preprod|staging/i.test(url)) {
    throw new Error(
      `CDO_API_URL apunta al entorno de PRUEBAS (${url}) en el deploy de producción. No se sincroniza: cargá la URL de producción de CDO en Vercel.`
    );
  }
}

const cdo: Conector = {
  provider: ProductOrigin.CDO,
  nombre: "CDO Promocionales",
  cargaGratis: true,
  async listar() {
    verificarEntornoCdo();
    catalogoCdo = null; // la lista congelada sale de un catalogo fresco
    const porId = await catalogoCdoVigente();
    const productos = [...porId.values()];
    // Guarda de catalogo entero, ANTES de escribir nada: si demasiados
    // productos activos vendrian sin variantes vendibles, la respuesta esta
    // rota (mismo umbral que los ausentes). Ver vaciosQueSeApagarian.
    const { seApagarian, umbral, activos } = await vaciosQueSeApagarian(productos);
    if (seApagarian > umbral) {
      throw new Error(
        `Respuesta anómala de CDO: ${seApagarian} productos activos vinieron sin variantes vendibles, y el umbral de seguridad es ${umbral} (sobre ${activos} activos). No se escribió nada.`
      );
    }
    return { ids: [...porId.keys()], total: productos.length };
  },
  async cargar(id) {
    // Sin try/catch A PROPOSITO: si falla la descarga del catalogo, falla el
    // TICK (error transitorio del motor, el cursor no avanza), no este
    // producto. Devolver "error" aca contaba como fallidos a todos los
    // productos que quedaban en el tick, y los salteaba en la corrida.
    verificarEntornoCdo();
    const p = (await catalogoCdoVigente()).get(id);
    // No esta en el catalogo de este tick: CDO lo saco despues de congelar
    // la lista. Es un ausente, no un fallo.
    return p ? { tipo: "ok", producto: p } : { tipo: "ausente" };
  },
  sinVariantes(producto) {
    return !tieneVariantesVendibles(producto as CdoProduct);
  },
  async sincronizar(producto, contexto) {
    const p = producto as CdoProduct;
    // Medicion de imagenes FUERA de la transaccion del producto (es red), con
    // cache: solo se mide lo nuevo, lo roto y lo vencido (lib/cdo/imagenes.ts).
    const { probes, sinMedir, fallidas } = await medirConCache(candidateImageUrls(p));
    const resumen = resumenCdoVacio();
    const r = await syncCdoProduct(p, resumen, probes, sinMedir, contexto.puedeApagarSinFoto);
    if (fallidas > 0) {
      console.warn(
        `[cdo-sync] Producto ${p.id}: ${fallidas} imagen(es) sin poder medir (timeout, 5xx o red)` +
          (r.fotos === "indeterminado" ? ": conserva su estado y se reintenta en la próxima corrida." : ".")
      );
    }
    if (r.variantesDesactivadas > 0) {
      console.warn(`[cdo-sync] Producto ${p.id}: ${r.variantesDesactivadas} variante(s) desactivada(s), ya no vienen en el listado.`);
    }
    if (resumen.sinImagen.length) console.warn(`[cdo-sync] Producto ${p.id} (${p.name}) sin ninguna imagen usable: queda inactivo.`);
    if (resumen.sinVariantes.length) console.warn(`[cdo-sync] Producto ${p.id} (${p.name}) SIN variantes vendibles: queda inactivo.`);
    for (const i of resumen.iconosDesconocidos) {
      console.warn(`[cdo-sync] Icono sin clasificar ${i.id} ("${i.label}", ${i.reason}): agregarlo a normalize.ts.`);
    }
    if (r.sinFoto === "retenido") {
      console.warn(`[cdo-sync] Producto ${p.id} (${p.name}) sin foto usable, pero la corrida ya llegó al umbral de apagados por foto: conserva su estado.`);
    }
    return {
      resultado: r.outcome === "created" ? "creado" : "actualizado",
      monedaSospechosa: false,
      sinFoto: r.sinFoto,
    };
  },
  async confirmarAusente(id) {
    // El detalle de CDO va por code, no por id: se guarda en externalId.
    const producto = await prisma.product.findUnique({ where: { cdoId: id }, select: { externalId: true } });
    const code = producto?.externalId;
    if (!code) {
      return { resultado: "no-verificado", motivo: "El producto no tiene el code de CDO guardado todavía (se guarda en la próxima corrida en que venga)." };
    }
    if (!CODE_CDO_CONFIABLE.test(code)) {
      return { resultado: "no-verificado", motivo: `El code de CDO (${JSON.stringify(code)}) no tiene la forma esperada: un 404 sobre él no confirmaría la baja.` };
    }
    try {
      await fetchProductByCode(code);
      return { resultado: "presente", motivo: "El detalle de CDO sigue respondiendo, pero no vino en el listado." };
    } catch (error) {
      if (error instanceof CdoHttpError && error.status === 404) {
        return { resultado: "baja", motivo: "CDO responde que el producto no existe." };
      }
      return {
        resultado: "no-verificado",
        motivo: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

/// Proveedores que corren sobre el motor. Uno que no esta aca no se puede
/// sincronizar desde el panel ni desde el cron (CDO entra en la etapa E).
const CONECTORES: Partial<Record<ProductOrigin, Conector>> = {
  [ProductOrigin.ZECAT]: zecat,
  [ProductOrigin.CDO]: cdo,
};

/// Todos los proveedores que corren sobre el motor (para el panel y los
/// crons que recorren todos).
export function proveedoresConConector(): ProductOrigin[] {
  return Object.keys(CONECTORES) as ProductOrigin[];
}

export function conectorDe(provider: ProductOrigin): Conector | null {
  return CONECTORES[provider] ?? null;
}

/// El segmento de la URL del cron (/api/cron/sync/zecat) -> proveedor.
export function proveedorDeSlug(slug: string): ProductOrigin | null {
  const p = Object.values(ProductOrigin).find((o) => o.toLowerCase() === slug.toLowerCase());
  return p && CONECTORES[p] ? p : null;
}
