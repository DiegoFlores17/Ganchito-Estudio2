"use client";

import { aCentavos, formatPriceArsCentavos } from "@/lib/format";
import { LEYENDAS_PRECIO } from "@/lib/leyendas-precio";
import type {
  OpcionImpresion,
  ProductPrintingSummary,
} from "@/app/(store)/cotizar/actions";

/// Selector de personalizacion de UN producto en /cotizar: tecnica, ubicacion
/// y tamano aproximado del logo, con el precio estimado.
///
/// Todo lo que muestra llega ya calculado del servidor (precio de venta por
/// opcion, y el monto del adicional por cantidad chica si corresponde). Aca no
/// hay costos ni umbral: no viajan.
export function QuotePrintingPicker({
  printing,
  quantity,
  seleccion,
  onChange,
}: {
  printing: ProductPrintingSummary;
  /// Total de unidades del producto HOY en el pedido (puede bajar si el
  /// cliente quita una linea).
  quantity: number;
  /// Clave de la opcion elegida, o "ninguna".
  seleccion: string;
  onChange: (seleccion: string) => void;
}) {
  const { opciones } = printing;
  const elegida = opciones.find((o) => o.key === seleccion) ?? null;

  const tecnicas = [...new Set(opciones.map((o) => o.technique))];
  const deLaTecnica = elegida
    ? opciones.filter((o) => o.technique === elegida.technique)
    : [];
  // Las areas se agrupan por id y no por nombre: el nombre es solo para
  // mostrar (Zecat los manda sucios y aca se pasan a formato titulo).
  const areas = [
    ...new Map(deLaTecnica.map((o) => [o.zecatAreaId, o.areaName])),
  ];
  const tamanos = elegida
    ? deLaTecnica.filter((o) => o.zecatAreaId === elegida.zecatAreaId)
    : [];

  // Al cambiar de tecnica o de ubicacion se toma el tamano MAS CHICO de la
  // nueva combinacion: mismo criterio que la preseleccion.
  const masChica = (lista: OpcionImpresion[]) => lista[0]?.key ?? "ninguna";

  const idBase = `impresion-${printing.productId}`;

  return (
    <div className="rounded-xl border border-foreground/10 p-4">
      <p className="text-sm font-medium text-foreground">
        Personalización · {printing.productName}
      </p>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Selector
          id={`${idBase}-tecnica`}
          label="Técnica"
          value={elegida?.technique ?? "ninguna"}
          onChange={(v) =>
            onChange(
              v === "ninguna"
                ? "ninguna"
                : masChica(opciones.filter((o) => o.technique === v))
            )
          }
        >
          {tecnicas.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
          <option value="ninguna">Sin personalizar</option>
        </Selector>

        {elegida && (
          <>
            <Selector
              id={`${idBase}-ubicacion`}
              label="Ubicación"
              value={elegida.zecatAreaId}
              onChange={(v) =>
                onChange(masChica(deLaTecnica.filter((o) => o.zecatAreaId === v)))
              }
            >
              {areas.map(([id, nombre]) => (
                <option key={id} value={id}>
                  {nombre}
                </option>
              ))}
            </Selector>

            <Selector
              id={`${idBase}-tamano`}
              label="Tamaño aproximado del logo"
              value={elegida.key}
              onChange={onChange}
            >
              {tamanos.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.sizeLabel}
                </option>
              ))}
            </Selector>
          </>
        )}
      </div>

      {elegida ? (
        <div className="mt-4 flex flex-col gap-1 text-sm">
          <p className="flex justify-between gap-4 text-foreground/80">
            <span>
              Personalización: {quantity} x{" "}
              {formatPriceArsCentavos(elegida.unitPrice)}
            </span>
            <span className="font-medium text-foreground">
              {/* En centavos: unitario x cantidad exacto, sin error de coma
                  flotante. */}
              {formatPriceArsCentavos((aCentavos(elegida.unitPrice) * quantity) / 100)}
            </span>
          </p>
          <p className="flex justify-between gap-4 text-foreground/80">
            <span>Preparación del logo (una vez por producto)</span>
            <span className="font-medium text-foreground">
              {formatPriceArsCentavos(elegida.setupPrice)}
            </span>
          </p>
          {printing.surcharge !== null && (
            <p className="flex justify-between gap-4 text-foreground/80">
              <span>{LEYENDAS_PRECIO.adicionalCantidadChica}</span>
              <span className="font-medium text-foreground">
                {formatPriceArsCentavos(printing.surcharge)}
              </span>
            </p>
          )}
          <p className="mt-2 text-xs text-foreground/60">
            Precio estimado para un {elegida.sizeLabel.charAt(0).toLowerCase()}
            {elegida.sizeLabel.slice(1)}. Cuando veamos tu diseño te
            confirmamos el valor final.
          </p>
          <p className="text-xs text-foreground/60">
            ¿Querés tu logo en más de un lugar? Contanos en las notas y lo
            sumamos al presupuesto.
          </p>
        </div>
      ) : (
        <p className="mt-3 text-xs text-foreground/60">
          Este producto se cotiza sin personalizar.
        </p>
      )}
    </div>
  );
}

function Selector({
  id,
  label,
  value,
  onChange,
  children,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-foreground/60">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        className="rounded-lg border border-foreground/15 bg-background px-3 py-2 text-sm outline-none focus:border-primary"
      >
        {children}
      </select>
    </div>
  );
}
