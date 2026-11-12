import { apiClient, fileApiClient } from "../client";
import type { SelfProfileService } from "../contracts/self-profile";
import { type Dto, obj, str } from "./dto";
import type { SelfProfile, SelfProfileAddress } from "@/types/self-profile";

function toAddress(dto: Dto): SelfProfileAddress {
  return {
    addressLine1: str(dto.addressLine1),
    addressLine2: str(dto.addressLine2),
    postalCode: str(dto.postalCode),
    city: str(dto.city),
    state: str(dto.state),
    country: str(dto.country),
  };
}

/** profile.md §8.2 → `SelfProfile`. Unwrapped per the contract; a `{ data }` envelope is tolerated. */
export function toSelfProfile(body: unknown): SelfProfile {
  const root = obj(body) ?? {};
  const dto = obj(root.data) ?? root;
  const firstName = str(dto.firstName) ?? "";
  const lastName = str(dto.lastName) ?? "";
  const avatar = obj(dto.avatar);
  const mimeType = str(avatar?.mimeType);
  const address = obj(dto.address);
  return {
    userId: str(dto.userId) ?? "",
    firstName,
    lastName,
    name: str(dto.name) ?? [firstName, lastName].filter(Boolean).join(" "),
    username: str(dto.username),
    email: str(dto.email) ?? "",
    phone: str(dto.phone),
    headline: str(dto.headline),
    aboutMe: str(dto.aboutMe),
    avatar: mimeType ? { mimeType, updatedAt: str(avatar?.updatedAt) ?? "" } : undefined,
    address: address ? toAddress(address) : undefined,
  };
}

export const httpSelfProfileService: SelfProfileService = {
  async get() {
    return toSelfProfile((await apiClient.get("/users/me")).data);
  },
  async update(_ctx, patch) {
    return toSelfProfile((await apiClient.patch("/users/me", patch)).data);
  },
  async uploadAvatar(_ctx, file) {
    const form = new FormData();
    form.append("file", file);
    return toSelfProfile((await fileApiClient.put("/users/me/avatar", form)).data);
  },
  async removeAvatar() {
    return toSelfProfile((await apiClient.delete("/users/me/avatar")).data);
  },
  async avatarBlob() {
    const res = await apiClient.get("/users/me/avatar", { responseType: "blob" });
    return res.data as Blob;
  },
};
