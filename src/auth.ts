import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

// Sin adapter de Prisma a proposito: no necesitamos que Auth.js administre
// sus propias tablas de User/Account/Session. Google resuelve la identidad,
// la autorizacion real (¿esta en AdminUser?, ¿que rol tiene?) se resuelve
// aparte, contra la base, en src/lib/admin-auth.ts — no aca. Esto mantiene
// este archivo compatible con el runtime Edge del middleware.
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  session: { strategy: "jwt" },
  pages: {
    signIn: "/admin/login",
  },
});
