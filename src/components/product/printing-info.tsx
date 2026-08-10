import type { Prisma } from "@prisma/client";

type PrintingArea = Prisma.PrintingAreaGetPayload<Record<string, never>>;
type PrintingType = Prisma.ProductPrintingTypeGetPayload<Record<string, never>>;

export function PrintingInfo({
  areas,
  types,
}: {
  areas: PrintingArea[];
  types: PrintingType[];
}) {
  if (areas.length === 0 && types.length === 0) return null;

  return (
    <div className="flex flex-col gap-4 border-t border-foreground/10 pt-6">
      <p className="text-sm font-medium text-foreground">Personalización</p>

      {areas.length > 0 && (
        <div>
          <p className="text-xs text-foreground/50">Áreas de impresión</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {areas.map((area) => (
              <span
                key={area.id}
                className="rounded-full bg-foreground/5 px-3 py-1 text-xs text-foreground/80"
              >
                {area.name}
                {area.heightCm && area.widthCm
                  ? ` — ${area.widthCm}×${area.heightCm} cm`
                  : ""}
              </span>
            ))}
          </div>
        </div>
      )}

      {types.length > 0 && (
        <div>
          <p className="text-xs text-foreground/50">Técnicas de impresión</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {types.map((type) => (
              <span
                key={type.id}
                className="rounded-full bg-foreground/5 px-3 py-1 text-xs text-foreground/80"
              >
                {type.name}
              </span>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-foreground/50">
        El logo se carga en el paso de cotización.
      </p>
    </div>
  );
}
