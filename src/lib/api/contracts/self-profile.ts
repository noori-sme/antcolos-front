import type { SelfProfile, SelfProfilePatch } from "@/types/self-profile";
import type { ServiceContext } from "./context";

/**
 * The signed-in person's own profile (NestJS `/users/me`,
 * ../antcolos/docs/requirements/profile.md). Every method acts on the caller
 * named by the token; `ctx` only scopes the cache. No organization permission
 * is needed (`@AuthenticatedUserScoped()`).
 */
export interface SelfProfileService {
  /** `GET /users/me`. */
  get(ctx: ServiceContext): Promise<SelfProfile>;
  /** `PATCH /users/me`, only the changed keys. Returns the updated profile. */
  update(ctx: ServiceContext, patch: SelfProfilePatch): Promise<SelfProfile>;
  /** `PUT /users/me/avatar` (multipart `file`). 413 over 5 MiB, 415 wrong type. */
  uploadAvatar(ctx: ServiceContext, file: File): Promise<SelfProfile>;
  /** `DELETE /users/me/avatar`. A no-op when there is no picture. */
  removeAvatar(ctx: ServiceContext): Promise<SelfProfile>;
  /** `GET /users/me/avatar`: the picture bytes. Only call when `avatar` is set. */
  avatarBlob(ctx: ServiceContext): Promise<Blob>;
}
