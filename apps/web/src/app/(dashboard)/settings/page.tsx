import { prisma } from "@mastershopee/database";
import { requireWorkspace } from "@/lib/session";
import { getPlanPermissionService } from "@/lib/billing-context";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProfileForm, WorkspaceForm, WhatsAppForm, PasswordForm } from "@/components/settings/settings-forms";
import { Badge } from "@/components/ui/badge";

export default async function SettingsPage() {
  const { user, workspace } = await requireWorkspace();
  const permissions = await getPlanPermissionService(workspace.id);

  const [members, whatsapp] = await Promise.all([
    prisma.workspaceMember.findMany({ where: { workspaceId: workspace.id }, include: { user: true } }),
    prisma.whatsappConfiguration.findUnique({ where: { workspaceId: workspace.id } }),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Configurações</h1>

      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">Perfil</TabsTrigger>
          <TabsTrigger value="company">Empresa</TabsTrigger>
          <TabsTrigger value="users">Usuários</TabsTrigger>
          <TabsTrigger value="whatsapp">WhatsApp</TabsTrigger>
          <TabsTrigger value="security">Segurança</TabsTrigger>
        </TabsList>

        <div className="mt-6">
          <TabsContent value="profile">
            <Card>
              <CardHeader>
                <CardTitle>Perfil</CardTitle>
              </CardHeader>
              <CardContent>
                <ProfileForm name={user.name} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="company">
            <Card>
              <CardHeader>
                <CardTitle>Empresa</CardTitle>
              </CardHeader>
              <CardContent>
                <WorkspaceForm name={workspace.name} timezone={workspace.timezone} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="users">
            <Card>
              <CardHeader>
                <CardTitle>Usuários</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {members.map((m) => (
                  <div key={m.id} className="flex items-center justify-between border-b border-border/60 py-2 text-sm last:border-0">
                    <div>
                      <p className="font-medium">{m.user.name}</p>
                      <p className="text-xs text-muted-foreground">{m.user.email}</p>
                    </div>
                    <Badge variant="outline">{m.role}</Badge>
                  </div>
                ))}
                <p className="pt-2 text-xs text-muted-foreground">
                  Limite do plano: {members.length} / {permissions.getMarketplaceLimit() === -1 ? "∞" : "—"} usuário(s)
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="whatsapp">
            <Card>
              <CardHeader>
                <CardTitle>WhatsApp</CardTitle>
              </CardHeader>
              <CardContent>
                <WhatsAppForm
                  phoneNumber={whatsapp?.phoneNumber}
                  dailyReportTime={whatsapp?.dailyReportTime ?? undefined}
                  dailyReportEnabled={whatsapp?.dailyReportEnabled}
                  disabled={!permissions.canUseWhatsApp().allowed}
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="security">
            <Card>
              <CardHeader>
                <CardTitle>Segurança</CardTitle>
              </CardHeader>
              <CardContent>
                <PasswordForm />
              </CardContent>
            </Card>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
