// Verifica que las fechas del panel salgan en hora argentina SIN importar la
// zona del proceso. Correrlo con dos zonas distintas:
//
//   TZ=UTC npx tsx scripts/audit-verify-dates.ts
//   TZ=Asia/Tokyo npx tsx scripts/audit-verify-dates.ts
//
// En Vercel el proceso corre en UTC: antes del fix, la corrida de las 14:10
// ART del 2026-10-08 se mostraba como "17:10".
import { formatDate, formatDateTime } from "../src/lib/format";

const casos: Array<{ nombre: string; obtenido: string; esperado: string }> = [
  {
    nombre: "corrida del 2026-10-08 14:10 ART (17:10Z)",
    obtenido: formatDateTime(new Date("2026-10-08T17:10:03.971Z")),
    esperado: "08/10/2026, 14:10",
  },
  {
    // 22:30 ART del 8 = 01:30Z del 9: en UTC ya es el dia siguiente.
    nombre: "fecha sola a las 22:30 ART (ya es el 9 en UTC)",
    obtenido: formatDate(new Date("2026-10-09T01:30:00Z")),
    esperado: "08/10/2026",
  },
  {
    // Medianoche: el caso que motivo hour12:false ("00:30", no "12:30").
    nombre: "00:30 ART en 24 horas",
    obtenido: formatDateTime(new Date("2026-10-08T03:30:00Z")),
    esperado: "08/10/2026, 00:30",
  },
];

let fallos = 0;
console.log(`Zona del proceso: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
for (const c of casos) {
  const ok = c.obtenido === c.esperado;
  if (!ok) fallos++;
  console.log(`${ok ? "OK  " : "FALLA"} ${c.nombre}: "${c.obtenido}"${ok ? "" : ` (esperado "${c.esperado}")`}`);
}
if (fallos) {
  console.error(`\n${fallos} caso(s) fallaron.`);
  process.exitCode = 1;
} else {
  console.log("\nTodos los casos pasan.");
}
