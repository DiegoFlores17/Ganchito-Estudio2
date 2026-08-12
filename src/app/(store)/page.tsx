const SWATCHES = [
  {
    name: "Indigo",
    hex: "#440670",
    role: "Fondos de bloque: hero, footer",
  },
  {
    name: "Mauveine",
    hex: "#750098",
    role: "Protagonista: titulos, elementos de marca",
  },
  {
    name: "Phlox",
    hex: "#C744F2",
    role: "Hovers, detalles, estados activos",
  },
  {
    name: "Yellow",
    hex: "#FFF835",
    role: "Acento: CTAs y highlights",
  },
  {
    name: "School bus yellow",
    hex: "#FFD91F",
    role: "Acento secundario / hover del amarillo",
  },
];

export default function Home() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-16">
      <p className="text-sm font-medium text-primary">
        Pagina de prueba temporal — se reemplaza cuando construyamos el home real
      </p>
      <h1 className="mt-2 text-4xl font-black tracking-tight text-foreground">
        Sistema de diseno
      </h1>
      <p className="mt-2 max-w-xl text-foreground/70">
        Paleta de marca y tipografia aplicadas, para validar antes de maquetar
        las paginas reales.
      </p>

      <section className="mt-16">
        <h2 className="text-2xl font-medium text-foreground">Paleta</h2>
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5">
          {SWATCHES.map((swatch) => (
            <div key={swatch.hex} className="flex flex-col gap-2">
              <div
                className="h-24 w-full rounded-lg"
                style={{ backgroundColor: swatch.hex }}
              />
              <div>
                <p className="text-sm font-medium text-foreground">
                  {swatch.name}
                </p>
                <p className="text-xs text-foreground/60">{swatch.hex}</p>
                <p className="mt-1 text-xs text-foreground/50">
                  {swatch.role}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-16">
        <h2 className="text-2xl font-medium text-foreground">Tipografia</h2>
        <p className="mt-1 text-sm text-foreground/60">Montserrat</p>

        <div className="mt-6 flex flex-col gap-6">
          <div>
            <p className="text-xs text-foreground/50">Black 900 — display</p>
            <p className="text-5xl font-black tracking-tight text-foreground">
              Merch corporativo con tu logo
            </p>
          </div>
          <div>
            <p className="text-xs text-foreground/50">Medium 500 — h2</p>
            <p className="text-2xl font-medium text-foreground">
              Explora, personaliza y pedi tu cotizacion
            </p>
          </div>
          <div>
            <p className="text-xs text-foreground/50">Regular 400 — body</p>
            <p className="max-w-xl text-base text-foreground/80">
              Zecat es nuestro proveedor mayorista: importamos productos y los
              personalizamos con el logo de tu empresa. Este parrafo usa el
              peso regular de Montserrat para texto de lectura.
            </p>
          </div>
        </div>
      </section>

      <section className="mt-16">
        <h2 className="text-2xl font-medium text-foreground">En uso</h2>
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <button className="rounded-full bg-accent px-6 py-3 text-sm font-medium text-primary-dark transition-colors hover:bg-accent-hover">
            Pedi tu cotizacion
          </button>
          <a
            href="#"
            className="text-sm font-medium text-foreground/80 transition-colors hover:text-primary-light"
          >
            Ver catalogo
          </a>
          <span className="rounded-full bg-accent px-3 py-1 text-xs font-medium text-primary-dark">
            Nuevo
          </span>
        </div>

        <div className="mt-6 rounded-xl bg-primary-dark px-8 py-10 text-white">
          <p className="text-xs text-white/60">Fondo de bloque — Indigo</p>
          <p className="mt-1 max-w-md text-2xl font-black tracking-tight">
            Asi se ve un hero o un bloque protagonico sobre violeta oscuro.
          </p>
        </div>
      </section>
    </div>
  );
}
