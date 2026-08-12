import { prisma } from "@/lib/prisma";
import { requireSuperAdmin } from "@/lib/admin-auth";
import { TeamManagement } from "@/components/admin/team-management";

export default async function EquipoPage() {
  const currentAdmin = await requireSuperAdmin();
  const admins = await prisma.adminUser.findMany({
    orderBy: { createdAt: "asc" },
  });

  return (
    <div>
      <h1 className="text-2xl font-medium text-foreground">Equipo</h1>
      <p className="mt-1 text-sm text-foreground/60">
        Quien tiene acceso al panel. Solo super-admins ven esta pantalla.
      </p>

      <div className="mt-6">
        <TeamManagement admins={admins} currentAdminId={currentAdmin.id} />
      </div>
    </div>
  );
}
