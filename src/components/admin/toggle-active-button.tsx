"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toggleProductActive } from "@/app/admin/(panel)/productos/actions";

export function ToggleActiveButton({
  productId,
  active,
}: {
  productId: string;
  active: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      await toggleProductActive(productId, !active);
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={handleClick}
      className="text-xs font-medium text-foreground/50 transition-colors hover:text-primary disabled:opacity-60"
    >
      {active ? "Pausar" : "Activar"}
    </button>
  );
}
