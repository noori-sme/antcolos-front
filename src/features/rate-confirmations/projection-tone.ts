import type { ProjectionState } from "@/types";

/**
 * How each projection state reads at a glance.
 *
 * `pending` is deliberately neutral rather than a warning: a projection waiting
 * for a module that has not been built is the honest state of this build, not
 * something a dispatcher did wrong. `needs_review` is a warning because it IS
 * something for them to do, and `failed` is a danger because something that
 * should have worked did not.
 */
export const PROJECTION_TONE: Record<ProjectionState, "success" | "outline" | "warning" | "danger"> = {
  processed: "success",
  pending: "outline",
  needs_review: "warning",
  failed: "danger",
};
