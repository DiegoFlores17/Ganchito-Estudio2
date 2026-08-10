"use client";

import { useState } from "react";
import Image from "next/image";

export function Gallery({
  images,
  productName,
}: {
  images: { url: string }[];
  productName: string;
}) {
  const [selected, setSelected] = useState(0);
  const active = images[selected];

  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-square overflow-hidden rounded-2xl bg-foreground/5">
        {active ? (
          <Image
            src={active.url}
            alt={productName}
            fill
            sizes="(min-width: 1024px) 45vw, 90vw"
            className="object-cover"
            priority
          />
        ) : null}
      </div>

      {images.length > 1 && (
        <div className="flex gap-3 overflow-x-auto">
          {images.map((image, index) => (
            <button
              key={image.url + index}
              type="button"
              onClick={() => setSelected(index)}
              className={
                "relative aspect-square w-16 shrink-0 overflow-hidden rounded-lg bg-foreground/5 transition-opacity " +
                (index === selected
                  ? "ring-2 ring-primary"
                  : "opacity-70 hover:opacity-100")
              }
            >
              <Image
                src={image.url}
                alt=""
                fill
                sizes="64px"
                className="object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
