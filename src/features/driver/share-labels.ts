import { requirementByKey } from "@/lib/documents/requirements";

/**
 * A requirement key as a person reads it.
 *
 * The label comes from the one requirement catalogue, so a document type added
 * there shows up here with no change: the sharing screens are not a second list
 * of what a driver can hold.
 */
export function documentLabelFor(requirementKey: string): string {
  return requirementByKey(requirementKey)?.label ?? requirementKey;
}
