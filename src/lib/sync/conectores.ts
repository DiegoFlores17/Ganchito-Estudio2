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

/// Lo que el motor del sync (lib/sync/motor.ts) necesita de un proveedor.
/// El motor no sabe nada de Zecat ni de CDO: recorre la lista congelada,
/// corta por tiempo, toma el lease, detecta ausentes y avisa — y le pide al
/// conector solo estas cinco cosas. CDO se monta en la etapa E
/// implementando esta misma interfaz.
export interface Conector {
  provider: ProductOrigin;
  nombre: string;
  /// La lista congelada: todos los ids del catalogo y el total que la API
  /// declara. Tiene que cerrar (ids distintos == total) o tirar.
  listar(): Promise<{ ids: string[]; total: number }>;
  /// El producto de un id. "ausente" = el proveedor dice que no existe (un
  /// 404 a mitad de corrida): NO es un fallo, es un ausente.
  cargar(id: string): Promise<Carga>;
  /// Si el producto vino sin ninguna variante vendible. Lo usa la guarda de
  /// "tanda entera vacia" del motor, ANTES de escribir.
  sinVariantes(producto: unknown): boolean;
  sincronizar(producto: unknown): Promise<ResultadoSincronizar>;
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
}

const zecat: Conector = {
  provider: ProductOrigin.ZECAT,
  nombre: "Zecat",
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

/// Proveedores que corren sobre el motor. Uno que no esta aca no se puede
/// sincronizar desde el panel ni desde el cron (CDO entra en la etapa E).
const CONECTORES: Partial<Record<ProductOrigin, Conector>> = {
  [ProductOrigin.ZECAT]: zecat,
};

export function conectorDe(provider: ProductOrigin): Conector | null {
  return CONECTORES[provider] ?? null;
}

/// El segmento de la URL del cron (/api/cron/sync/zecat) -> proveedor.
export function proveedorDeSlug(slug: string): ProductOrigin | null {
  const p = Object.values(ProductOrigin).find((o) => o.toLowerCase() === slug.toLowerCase());
  return p && CONECTORES[p] ? p : null;
}
