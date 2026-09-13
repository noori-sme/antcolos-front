import { FileCheck2, FileWarning } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DOCUMENT_KIND_LABEL } from "@/config/documents";
import { missingRequiredDocuments, type Load } from "@/types";

/** Paperwork readiness — the thing that blocks invoicing. */
export function DocumentStatus({ load }: { load: Load }) {
  const missing = missingRequiredDocuments(load);
  if (missing.length === 0) {
    return (
      <Badge tone="success">
        <FileCheck2 aria-hidden className="size-3" />
        Complete
      </Badge>
    );
  }
  return (
    <Badge
      tone="warning"
      title={`Missing: ${missing.map((m) => DOCUMENT_KIND_LABEL[m.kind]).join(", ")}`}
    >
      <FileWarning aria-hidden className="size-3" />
      {missing.length} missing
    </Badge>
  );
}
