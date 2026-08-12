import { NextResponse } from "next/server";
import { auth } from "@/auth";

// Corre en Edge: solo puede chequear si hay una sesion de Google valida.
// La autorizacion real (¿esta en AdminUser?, que rol tiene?) se resuelve
// contra la base en el layout protegido (runtime Node, con Prisma) — ver
// src/lib/admin-auth.ts. Esta capa solo evita que alguien sin sesion
// llegue siquiera a esas paginas.
const PUBLIC_ADMIN_PATHS = ["/admin/login", "/admin/sin-acceso"];

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isPublicAdminPath = PUBLIC_ADMIN_PATHS.some((path) =>
    pathname.startsWith(path)
  );

  if (isPublicAdminPath || !!req.auth) {
    return NextResponse.next();
  }

  const loginUrl = new URL("/admin/login", req.nextUrl.origin);
  return NextResponse.redirect(loginUrl);
});

export const config = {
  matcher: ["/admin/:path*"],
};
