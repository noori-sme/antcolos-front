"use client";

import { useCallback, useEffect, useState } from "react";
import type { CarrierRelationship, DriverDocument, DriverProfile } from "@/types";
import { mockGetDriverProfile, mockListDocuments, mockListRelationships } from "./mock-driver";

export interface DriverData {
  profile: DriverProfile | null;
  relationships: CarrierRelationship[];
  documents: DriverDocument[];
  loading: boolean;
  setDocuments: (next: DriverDocument[]) => void;
  setRelationships: (next: CarrierRelationship[]) => void;
  reload: () => void;
}

/** Everything the driver screens read, loaded once and shared by the screen. */
export function useDriverData(): DriverData {
  const [profile, setProfile] = useState<DriverProfile | null>(null);
  const [relationships, setRelationships] = useState<CarrierRelationship[]>([]);
  const [documents, setDocuments] = useState<DriverDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([mockGetDriverProfile(), mockListRelationships(), mockListDocuments()]).then(
      ([p, r, d]) => {
        if (cancelled) return;
        setProfile(p);
        setRelationships(r);
        setDocuments(d);
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  return { profile, relationships, documents, loading, setDocuments, setRelationships, reload };
}

/** The relationship the driver is currently working under, if any. */
export function currentRelationship(
  relationships: readonly CarrierRelationship[],
): CarrierRelationship | undefined {
  return (
    relationships.find((r) => r.status === "onboarding") ??
    relationships.find((r) => r.status === "active") ??
    relationships.find((r) => r.status !== "ended")
  );
}
