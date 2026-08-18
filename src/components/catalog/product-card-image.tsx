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
  const imageRef = useRef<HTMLImageElement>(null);

  // Si la imagen ya estaba en cache del navegador, termina de cargar ANTES de
  // que hidrate el componente y el onLoad no llega a dispararse nunca. Sin
  // este chequeo, esas fotos se quedarian en opacity-0, invisibles.
  useEffect(() => {
    if (imageRef.current?.complete) setLoaded(true);
  }, []);

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
        onLoad={() => setLoaded(true)}
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
