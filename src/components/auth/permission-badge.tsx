import { Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { permissionMeta } from "@/lib/permissions/catalog";
import type { PermissionKey } from "@/types";

export function PermissionBadge({ permissionKey }: { permissionKey: PermissionKey }) {
  const meta = permissionMeta(permissionKey);
  return (
    <Badge tone={meta.sensitive ? "warning" : "outline"} title={meta.description}>
      {meta.sensitive ? <Lock aria-hidden className="size-3" /> : null}
      {meta.label}
    </Badge>
  );
}
