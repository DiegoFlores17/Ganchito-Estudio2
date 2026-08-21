"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";

/// Foto de producto con shimmer mientras carga.
///
/// Es la opcion A de las dos que se evaluaron para los cuadrados grises del
/// catalogo. La alternativa era placeholder="blur" de next/image, pero con
/// imagenes remotas exige un blurDataURL generado a mano, y las de Zecat se
/// borran y recrean en cada sync: habria que descargar 552 imagenes por
/// corrida solo para un efecto visual. Esto no toca el sync ni el schema, y
/// vale igual para productos de Zecat y manuales.
///
/// Se mantiene como client component chico y aislado a proposito: la
/// ProductCard sigue siendo server component y solo esta parte lleva JS.
export function ProductCardImage({
  src,
  alt,
  sizes,
  className = "",
}: {
  src: string;
  alt: string;
  sizes: string;
  className?: string;
}) {
  const [loaded, setLoaded] = useState(false);
  /// Fotos con una proporcion extrema se muestran ENTERAS, con aire a los
  /// costados, en vez de recortadas para llenar el cuadrado.
  ///
  /// El proveedor tiene fotos legitimas de objetos muy alargados
  /// ("Destornillador" es 209x1514) y tambien recortes de screenshot subidos
  /// por error (483x72). Con object-cover las dos quedan como una banda
  /// ilegible que se lee como card vacia. Filtrarlas seria tirar producto
  /// vendible, asi que se cambia el encuadre.
  ///
  /// La proporcion se lee del propio navegador al cargar la imagen: no hace
  /// falta guardarla en la base, y de paso vale para cualquier proveedor.
  const [deforme, setDeforme] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);

  // Si la imagen ya estaba en cache del navegador, termina de cargar ANTES de
  // que hidrate el componente y el onLoad no llega a dispararse nunca. Sin
  // este chequeo, esas fotos se quedarian en opacity-0, invisibles.
  useEffect(() => {
    if (imageRef.current?.complete) marcarCargada(imageRef.current);
  }, []);

  /// Proporcion a partir de la cual la foto se muestra entera. Igual que
  /// EXTREME_ASPECT_RATIO en lib/cdo/normalize, donde se usa para contar
  /// portadas problematicas en el sync.
  function marcarCargada(img: HTMLImageElement | null) {
    if (img?.naturalWidth && img.naturalHeight) {
      const ratio = Math.max(
        img.naturalWidth / img.naturalHeight,
        img.naturalHeight / img.naturalWidth
      );
      if (ratio > 2.5) setDeforme(true);
    }
    setLoaded(true);
  }

  return (
    <>
      <div
        aria-hidden
        className={
          "absolute inset-0 bg-primary/[0.07] transition-opacity duration-300 " +
          (loaded ? "opacity-0" : "animate-pulse")
        }
      />

      <Image
        ref={imageRef}
        src={src}
        alt={alt}
        fill
        sizes={sizes}
        onLoad={(e) => marcarCargada(e.currentTarget)}
        // Inline y no una clase: object-cover viene en el className que manda
        // la card, y entre dos utilidades de Tailwind gana la que este despues
        // en el CSS generado, no la que este despues en el string. Un estilo
        // inline le gana a las dos, sin depender de ese orden.
        style={deforme ? { objectFit: "contain", padding: "0.75rem" } : undefined}
        // `transition` (no transition-opacity) para que siga animando tambien
        // el transform: la card le pasa un group-hover:scale por className.
        className={
          `transition duration-300 ${className} ` +
          (loaded ? "opacity-100" : "opacity-0")
        }
      />
    </>
  );
}
