import type { Paginated } from "@/types/common";
import type {
  CreateCredentialInput, CredentialHistoryEntry, CredentialListQuery, CredentialStatus,
  DriverCredential, UpdateCredentialInput,
} from "@/types/driver-credential";
import type { ServiceContext } from "./context";

/**
 * Driver credentials (NestJS `/credentials`,
 * ../antcolos/docs/requirements/driver-credentials-api-contract.md, backend plan 40).
 */
export interface DriverCredentialsService {
  /** `GET /credentials` (`credential.read`): soonest expiry first. */
  list(ctx: ServiceContext, query: CredentialListQuery): Promise<Paginated<DriverCredential>>;
  /** `GET /credentials/mine` (`credential.read_own`). */
  listMine(ctx: ServiceContext, query?: { page?: number; pageSize?: number }): Promise<Paginated<DriverCredential>>;
  /** `POST /credentials` (`credential.create`, Idempotency-Key). */
  create(ctx: ServiceContext, input: CreateCredentialInput, idempotencyKey: string): Promise<DriverCredential>;
  /** `PATCH /credentials/:id` (`credential.update`): label and dates only. */
  update(ctx: ServiceContext, id: string, input: UpdateCredentialInput): Promise<DriverCredential>;
  /** `POST /credentials/:id/status` (`credential.update`, Idempotency-Key). */
  changeStatus(
    ctx: ServiceContext,
    id: string,
    input: { status: CredentialStatus; reason?: string },
    idempotencyKey: string,
  ): Promise<DriverCredential>;
  /** `GET /credentials/:id/history` (`credential.read`): oldest first. */
  history(ctx: ServiceContext, id: string, query?: { page?: number; pageSize?: number }): Promise<Paginated<CredentialHistoryEntry>>;
}
