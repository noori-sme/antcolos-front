"use client";

import { useQuery } from "@tanstack/react-query";
import {
  CircleAlert, ExternalLink, FileSpreadsheet, Landmark, ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import { ErrorState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  FACTORING_CONNECTION_STATUS_LABEL, FACTORING_IMPORT_ROW_LABEL,
  FACTORING_MODE_DESCRIPTION, FACTORING_MODE_LABEL, FACTORING_MOCK_NOTICE,
  FACTORING_PROVIDER_LABEL, FACTORING_VISIBILITY_LABEL,
  type FactoringCheckPolicy, type FactoringConnection, type FactoringConnectionMode,
  type FactoringImportPreview, type FactoringImportRowInput, type FactoringProviderKind,
  type FactoringVisibility,
} from "@/types";
import { services } from "@/lib/api";
import { useServiceContext } from "@/lib/api/use-service-context";
import { relativeAge } from "@/lib/api/mock/factoring-registry";
import { useCan } from "@/lib/session/hooks";
import { orgKey } from "@/lib/query/keys";

/**
 * Settings → Factoring.
 *
 * ★ THIS IS AN ADMINISTRATION SCREEN, NOT A DAILY ONE ★
 * A dispatcher's factoring work happens where the freight is — on the Load
 * Search result and the Opportunity. Nothing here is part of working a truck,
 * and nothing about a specific load belongs on this page. It exists for three
 * things a carrier does rarely: connect the account, set the rules, and bring
 * in the factor's own debtor list.
 *
 * ███ ANTCOLOS IS NOT CONNECTED TO A FACTORING COMPANY ███ Said on the page,
 * not only in a comment, because a settings screen with a green "Connected"
 * badge is exactly where somebody would conclude otherwise.
 */
export function FactoringSettingsScreen() {
  const ctx = useServiceContext();
  const mayManage = useCan("factoring:manage");

  /**
   * The connection, plus how long it has been since anything came through it.
   *
   * The age is worked out HERE, in the query function, rather than while the
   * card renders. A component that reads the clock mid-render produces a
   * different tree on every re-render for reasons React cannot see; the query
   * is where reading it is a legitimate side effect.
   */
  const connectionQuery = useQuery({
    queryKey: [...orgKey(ctx?.organizationId ?? "none"), "factoring", "connection"],
    queryFn: async () => {
      const connection = (await services.factoring.connection(ctx!, ctx!.organizationId)) ?? null;
      const quietForMs = connection?.lastResultAt
        ? Date.now() - Date.parse(connection.lastResultAt)
        : undefined;
      return { connection, quietForMs };
    },
    enabled: Boolean(ctx),
  });

  const policyQuery = useQuery({
    queryKey: [...orgKey(ctx?.organizationId ?? "none"), "factoring", "policy"],
    queryFn: async () => services.factoring.policy(ctx!, ctx!.organizationId),
    enabled: Boolean(ctx),
  });

  const batchesQuery = useQuery({
    queryKey: [...orgKey(ctx?.organizationId ?? "none"), "factoring", "batches"],
    queryFn: async () => services.factoring.importBatches(ctx!, ctx!.organizationId),
    enabled: Boolean(ctx),
  });

  function refresh() {
    void connectionQuery.refetch();
    void policyQuery.refetch();
    void batchesQuery.refetch();
  }

  const pending = connectionQuery.isPending || policyQuery.isPending;

  return (
    <div className="space-y-section">
      <PageHeader
        title="Factoring"
        description="Which factoring company this carrier uses, how its answers reach Antcolos, and what happens when a broker is not approved."
      />

      <p className="rounded-md border border-dashed border-border bg-surface-sunken px-3.5 py-2.5 text-[0.8125rem] leading-relaxed text-fg-muted">
        {FACTORING_MOCK_NOTICE}
      </p>

      {pending ? (
        <LoadingSkeleton rows={3} />
      ) : connectionQuery.isError ? (
        <ErrorState
          description={connectionQuery.error.message}
          onRetry={() => void connectionQuery.refetch()}
        />
      ) : (
        <>
          <ConnectionCard
            connection={connectionQuery.data?.connection ?? null}
            quietForMs={connectionQuery.data?.quietForMs}
            mayManage={mayManage}
            onChanged={refresh}
          />
          {policyQuery.data ? (
            /*
             * Keyed on the saved-at stamp, so the card RESETS to the stored
             * policy whenever one actually lands. That is what lets the
             * controls below answer a click instantly — they hold the pending
             * value themselves — without ever drifting from what was saved.
             */
            <PolicyCard
              key={policyQuery.data.updatedAt}
              policy={policyQuery.data}
              mayManage={mayManage}
              onChanged={refresh}
            />
          ) : null}
          {connectionQuery.data?.connection && mayManage ? (
            <ImportCard batchCount={batchesQuery.data?.length ?? 0} onChanged={refresh} />
          ) : null}
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Connection                                                                  */
/* -------------------------------------------------------------------------- */

const MODES: FactoringConnectionMode[] = ["mock_adapter", "import", "email", "manual", "api"];
const PROVIDERS: FactoringProviderKind[] = ["otr", "rts", "triumph", "apex", "other"];

function ConnectionCard({
  connection, quietForMs, mayManage, onChanged,
}: {
  connection: FactoringConnection | null;
  /** How long since anything came through, measured when the data was read. */
  quietForMs?: number;
  mayManage: boolean;
  onChanged: () => void;
}) {
  const ctx = useServiceContext();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [providerKind, setProviderKind] = useState<FactoringProviderKind>(
    connection?.providerKind ?? "otr",
  );
  const [accountLabel, setAccountLabel] = useState(connection?.accountLabel ?? "");
  const [accountReference, setAccountReference] = useState(connection?.accountReference ?? "");
  const [mode, setMode] = useState<FactoringConnectionMode>(connection?.mode ?? "manual");
  const [email, setEmail] = useState(connection?.fallback.creditCheckEmail ?? "");
  const [portalUrl, setPortalUrl] = useState(connection?.fallback.portalUrl ?? "");
  const [phone, setPhone] = useState(connection?.fallback.phone ?? "");
  const [instructions, setInstructions] = useState(connection?.fallback.instructions ?? "");

  async function save() {
    if (!ctx) return;
    setBusy(true);
    setError(null);
    try {
      await services.factoring.connect(ctx, {
        carrierOrganizationId: ctx.organizationId,
        providerKind,
        accountLabel: accountLabel.trim() || FACTORING_PROVIDER_LABEL[providerKind],
        accountReference: accountReference.trim() || undefined,
        mode,
        fallback: {
          creditCheckEmail: email.trim() || undefined,
          portalUrl: portalUrl.trim() || undefined,
          phone: phone.trim() || undefined,
          instructions: instructions.trim() || undefined,
        },
      });
      setEditing(false);
      onChanged();
    } catch {
      setError("That could not be saved. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  const looksStale = quietForMs !== undefined && quietForMs > 7 * 24 * 3_600_000;

  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-e1">
      <h2 className="flex items-center gap-2 text-[0.875rem] font-semibold text-fg">
        <Landmark className="size-4 text-fg-subtle" aria-hidden />
        Factoring account
        {connection ? (
          <Badge tone={connection.status === "connected" ? "success" : "warning"}>
            {FACTORING_CONNECTION_STATUS_LABEL[connection.status]}
          </Badge>
        ) : (
          <Badge tone="neutral">{FACTORING_CONNECTION_STATUS_LABEL.not_connected}</Badge>
        )}
      </h2>

      {connection && !editing ? (
        <div className="mt-3 space-y-1.5 text-[0.8125rem] text-fg-muted">
          <p className="text-fg">
            <span className="font-medium">{connection.providerName}</span>
            {" · "}{connection.accountLabel}
            {connection.accountReference ? ` · ${connection.accountReference}` : ""}
          </p>
          <p>
            {FACTORING_MODE_LABEL[connection.mode]} — {FACTORING_MODE_DESCRIPTION[connection.mode]}
          </p>
          <p className="text-[0.75rem]">
            {connection.lastResultAt
              ? `Last answer recorded ${relativeAge(connection.lastResultAt)}.`
              : "No answer has been recorded through this connection yet."}
          </p>
          {looksStale ? (
            <p className="flex items-center gap-1.5 rounded-md border border-st-warning/40 bg-st-warning-bg/40 px-2.5 py-1.5 text-[0.75rem] text-fg">
              <CircleAlert className="size-3.5 shrink-0 text-st-warning" aria-hidden />
              Nothing has come through this connection in over a week. Approvals recorded before
              then will be reading as stale on Load Search.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2 pt-1">
            {connection.fallback.portalUrl ? (
              <Button variant="ghost" size="sm" asChild>
                <a href={connection.fallback.portalUrl} target="_blank" rel="noreferrer noopener">
                  <ExternalLink aria-hidden />
                  Open {connection.providerName}
                </a>
              </Button>
            ) : null}
            {mayManage ? (
              <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>Change</Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {!connection && !editing ? (
        <div className="mt-3">
          <p className="text-[0.8125rem] leading-relaxed text-fg-muted">
            No factoring account is connected, so every broker reads as
            <span className="font-medium text-fg"> Factoring not connected </span>
            on Load Search — never as rejected, and never as approved.
          </p>
          {mayManage ? (
            <Button variant="primary" size="sm" className="mt-2" onClick={() => setEditing(true)}>
              Connect a factoring account
            </Button>
          ) : (
            <p className="mt-2 text-[0.75rem] text-fg-subtle">
              Connecting a factoring account needs the &ldquo;Manage the factoring
              connection&rdquo; permission.
            </p>
          )}
        </div>
      ) : null}

      {editing ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Factoring company" htmlFor="factoring-provider">
            <select
              id="factoring-provider"
              value={providerKind}
              onChange={(e) => setProviderKind(e.target.value as FactoringProviderKind)}
              className="h-control w-full rounded-md border border-border bg-surface px-2.5 text-[0.875rem] text-fg"
            >
              {PROVIDERS.map((p) => (
                <option key={p} value={p}>{FACTORING_PROVIDER_LABEL[p]}</option>
              ))}
            </select>
          </Field>

          <Field
            label="How their answers reach Antcolos"
            htmlFor="factoring-mode"
            hint={FACTORING_MODE_DESCRIPTION[mode]}
          >
            <select
              id="factoring-mode"
              value={mode}
              onChange={(e) => setMode(e.target.value as FactoringConnectionMode)}
              className="h-control w-full rounded-md border border-border bg-surface px-2.5 text-[0.875rem] text-fg"
            >
              {MODES.map((m) => (
                <option key={m} value={m}>
                  {FACTORING_MODE_LABEL[m]}
                  {m === "api" ? " — reserved, not available" : ""}
                </option>
              ))}
            </select>
          </Field>

          <Field label="What you call this account" htmlFor="factoring-label">
            <Input id="factoring-label" value={accountLabel} onChange={(e) => setAccountLabel(e.target.value)} placeholder="OTR — main" />
          </Field>

          <Field
            label="Their client number for you"
            htmlFor="factoring-account-ref"
            hint="The number printed on your statements. Never a password — Antcolos has nowhere to put one."
          >
            <Input id="factoring-account-ref" value={accountReference} onChange={(e) => setAccountReference(e.target.value)} />
          </Field>

          <Field label="Their credit-check email" htmlFor="factoring-email" className="sm:col-span-1">
            <Input id="factoring-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>

          <Field label="Their portal" htmlFor="factoring-portal" hint="Opened by a person, in their own browser.">
            <Input id="factoring-portal" value={portalUrl} onChange={(e) => setPortalUrl(e.target.value)} />
          </Field>

          <Field label="Their credit desk" htmlFor="factoring-phone">
            <Input id="factoring-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>

          <Field label="Anything your dispatchers need told" htmlFor="factoring-instructions" className="sm:col-span-2">
            <Textarea id="factoring-instructions" rows={2} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
          </Field>

          {error ? (
            <p role="alert" className="sm:col-span-2 text-[0.75rem] text-st-danger">{error}</p>
          ) : null}

          <div className="flex gap-2 sm:col-span-2">
            <Button variant="primary" size="sm" disabled={busy} onClick={() => void save()}>Save</Button>
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Policy                                                                      */
/* -------------------------------------------------------------------------- */

const VISIBILITIES: FactoringVisibility[] = ["show", "warn", "deprioritize", "hide"];

function PolicyCard({
  policy, mayManage, onChanged,
}: {
  policy: FactoringCheckPolicy;
  mayManage: boolean;
  onChanged: () => void;
}) {
  const ctx = useServiceContext();
  const [busy, setBusy] = useState(false);
  /*
   * ★ THE SWITCH ANSWERS THE CLICK ★
   * Rendering straight from the query means a tick springs back for as long as
   * the save takes, which reads as "it refused me" and gets clicked again. The
   * pending value lives here and the `key` above puts it back in step with the
   * server the moment the save lands.
   */
  const [pending, setPending] = useState<Partial<FactoringCheckPolicy>>({});
  const shown: FactoringCheckPolicy = { ...policy, ...pending };

  async function patch(next: Partial<FactoringCheckPolicy>) {
    if (!ctx || !mayManage) return;
    setPending((prev) => ({ ...prev, ...next }));
    setBusy(true);
    try {
      await services.factoring.setPolicy(ctx, ctx.organizationId, next);
      onChanged();
    } catch {
      // Put it back rather than leaving a switch showing a change nobody saved.
      setPending((prev) => {
        const rolled = { ...prev };
        for (const key of Object.keys(next)) delete rolled[key as keyof FactoringCheckPolicy];
        return rolled;
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-e1">
      <h2 className="flex items-center gap-2 text-[0.875rem] font-semibold text-fg">
        <ShieldCheck className="size-4 text-fg-subtle" aria-hidden />
        What happens when a broker is not approved
      </h2>

      <div className="mt-3 space-y-3">
        <Toggle
          id="policy-require"
          label="Booking requires a current factoring approval"
          hint="With this off, the answer is still shown on every load — it just stops nothing."
          checked={shown.requireApprovalToBook}
          disabled={!mayManage || busy}
          onChange={(v) => void patch({ requireApprovalToBook: v })}
        />
        <Toggle
          id="policy-conditional"
          label="A conditional approval may be booked"
          hint="The conditions are always shown on the booking screen."
          checked={shown.conditionalMayBook}
          disabled={!mayManage || busy}
          onChange={(v) => void patch({ conditionalMayBook: v })}
        />
        <Toggle
          id="policy-override"
          label="An authorized person may book past a block"
          hint="Every override needs a typed reason and writes an audit entry that cannot be edited."
          checked={shown.allowOverride}
          disabled={!mayManage || busy}
          onChange={(v) => void patch({ allowOverride: v })}
        />
        <Toggle
          id="policy-driver"
          label="An unapproved opportunity may still be sent to a driver to look at"
          hint="It is labelled &ldquo;Booking requires factoring approval&rdquo; and never as approved."
          checked={shown.allowDriverReviewBeforeApproval}
          disabled={!mayManage || busy}
          onChange={(v) => void patch({ allowDriverReviewBeforeApproval: v })}
        />

        <Field
          label="How long an answer stays current"
          htmlFor="policy-freshness"
          hint="After this, an approval reads as “Recheck factoring” — never as a refusal."
        >
          <Input
            id="policy-freshness"
            inputMode="numeric"
            className="max-w-32"
            defaultValue={String(shown.freshnessHours)}
            disabled={!mayManage || busy}
            onBlur={(e) => {
              const value = Number.parseInt(e.target.value, 10);
              if (Number.isFinite(value) && value !== shown.freshnessHours) {
                void patch({ freshnessHours: value });
              }
            }}
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-3">
          <VisibilityField
            id="policy-rejected" label="Rejected loads in Load Search"
            value={shown.rejected} disabled={!mayManage || busy}
            onChange={(v) => void patch({ rejected: v })}
          />
          <VisibilityField
            id="policy-unknown" label="Unchecked loads"
            value={shown.unknown} disabled={!mayManage || busy}
            onChange={(v) => void patch({ unknown: v })}
          />
          <VisibilityField
            id="policy-stale" label="Stale approvals"
            value={shown.stale} disabled={!mayManage || busy}
            onChange={(v) => void patch({ stale: v })}
          />
        </div>

        <p className="text-[0.75rem] leading-relaxed text-fg-subtle">
          Hiding is never the default. Load Search always says how many loads a policy is keeping
          off the screen, so an empty result is never mistaken for an empty market.
        </p>
      </div>
    </section>
  );
}

function Toggle({
  id, label, hint, checked, disabled, onChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 accent-[var(--color-primary)]"
      />
      <label htmlFor={id} className="min-w-0">
        <span className="block text-[0.8125rem] font-medium text-fg">{label}</span>
        <span className="block text-[0.75rem] leading-relaxed text-fg-subtle">{hint}</span>
      </label>
    </div>
  );
}

function VisibilityField({
  id, label, value, disabled, onChange,
}: {
  id: string;
  label: string;
  value: FactoringVisibility;
  disabled: boolean;
  onChange: (next: FactoringVisibility) => void;
}) {
  return (
    <Field label={label} htmlFor={id}>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as FactoringVisibility)}
        className="h-control w-full rounded-md border border-border bg-surface px-2.5 text-[0.875rem] text-fg"
      >
        {VISIBILITIES.map((v) => (
          <option key={v} value={v}>{FACTORING_VISIBILITY_LABEL[v]}</option>
        ))}
      </select>
    </Field>
  );
}

/* -------------------------------------------------------------------------- */
/* Import                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Bringing in the factor's own debtor list.
 *
 * Preview, then commit — never one step. The rows a person has to look at are
 * exactly the ones a single "Import" button would hide, and a factoring export
 * is full of them: names with no MC, MCs the directory does not know, status
 * words this parser has never seen.
 */
function ImportCard({ batchCount, onChanged }: { batchCount: number; onChanged: () => void }) {
  const ctx = useServiceContext();
  const [text, setText] = useState("");
  const [label, setLabel] = useState("debtor-list.csv");
  const [preview, setPreview] = useState<FactoringImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function runPreview() {
    if (!ctx) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const rows = parseCsv(text);
      if (rows.length === 0) {
        setError("No rows were readable. The first line should be the column names.");
        return;
      }
      setPreview(await services.factoring.previewImport(ctx, {
        carrierOrganizationId: ctx.organizationId, label: label.trim() || "debtor-list.csv", rows,
      }));
    } catch {
      setError("That could not be read. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!ctx || !preview) return;
    setBusy(true);
    setError(null);
    try {
      const result = await services.factoring.commitImport(ctx, preview.batch.batchId);
      setDone(
        `${result.committed} result${result.committed === 1 ? "" : "s"} recorded`
        + `${result.skipped > 0 ? `, ${result.skipped} left for review` : ""}.`,
      );
      setPreview(await services.factoring.previewImport(ctx, {
        carrierOrganizationId: ctx.organizationId,
        label: preview.batch.label,
        rows: preview.rows.map((r) => r.input),
      }));
      onChanged();
    } catch {
      setError("That could not be committed. Rows already recorded were kept.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-e1">
      <h2 className="flex items-center gap-2 text-[0.875rem] font-semibold text-fg">
        <FileSpreadsheet className="size-4 text-fg-subtle" aria-hidden />
        Import your factor&rsquo;s debtor list
        {batchCount > 0 ? (
          <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[0.6875rem] font-medium tabular-nums text-fg-muted">
            {batchCount}
          </span>
        ) : null}
      </h2>

      <p className="mt-1 text-[0.75rem] leading-relaxed text-fg-muted">
        Download the credit or debtor export from your own factoring portal and paste it here.
        Antcolos never signs in to your factor for you. Rows are matched on the MC number only —
        a company name alone is never enough to attach an approval to a broker.
      </p>

      <div className="mt-3 grid gap-3">
        <Field label="File name" htmlFor="import-label">
          <Input id="import-label" value={label} onChange={(e) => setLabel(e.target.value)} className="max-w-sm" />
        </Field>
        <Field
          label="Rows"
          htmlFor="import-rows"
          hint="CSV with a header row: debtor, mc, status, limit, available, reason, expires."
        >
          <Textarea
            id="import-rows"
            data-testid="factoring-import-rows"
            rows={5}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"debtor,mc,status,limit,available\nApex Logistics LLC,MC-612884,Approved,25000,18400"}
            className="font-mono text-[0.6875rem]"
          />
        </Field>

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" disabled={busy || !text.trim()} onClick={() => void runPreview()}>
            Preview
          </Button>
          {preview ? (
            <Button
              variant="primary"
              size="sm"
              disabled={busy || preview.summary.ready === 0}
              data-testid="factoring-import-commit"
              onClick={() => void commit()}
            >
              Import {preview.summary.ready} ready row{preview.summary.ready === 1 ? "" : "s"}
            </Button>
          ) : null}
        </div>

        {error ? (
          <p role="alert" className="text-[0.75rem] text-st-danger">{error}</p>
        ) : null}
        {done ? (
          <p className="text-[0.75rem] text-st-success" data-testid="factoring-import-done">{done}</p>
        ) : null}

        {preview ? (
          <div className="rounded-md border border-border">
            <p className="border-b border-border px-3 py-2 text-[0.75rem] text-fg-muted">
              {preview.summary.ready} ready · {preview.summary.needsReview} need a person ·{" "}
              {preview.summary.alreadyCommitted} already imported · {preview.summary.supersedes}{" "}
              would replace an existing answer, keeping it on the record.
              {preview.resumed ? " This exact file was already staged; nothing was added." : ""}
            </p>
            <ul className="divide-y divide-border">
              {preview.rows.map((row) => (
                <li key={row.rowId} className="px-3 py-2 text-[0.75rem]">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-fg">{row.input.debtorName}</span>
                    {row.mcNumber ? <span className="text-fg-muted">MC {row.mcNumber}</span> : null}
                    <Badge tone={row.state === "matched" ? "success" : row.state === "already_committed" ? "neutral" : "warning"}>
                      {FACTORING_IMPORT_ROW_LABEL[row.state]}
                    </Badge>
                  </p>
                  {row.reviewReason ? (
                    <p className="mt-0.5 leading-relaxed text-fg-muted">{row.reviewReason}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/**
 * A pasted export into rows.
 *
 * Column names vary by factor, so a handful of aliases are recognised and
 * anything else is ignored rather than guessed at. A row whose status column is
 * missing is not assumed to be a refusal — it simply has no status, and the
 * preview marks it for a person.
 */
export function parseCsv(text: string): FactoringImportRowInput[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  const header = splitRow(lines[0]).map((h) => h.trim().toLowerCase());
  const at = (names: string[]) => header.findIndex((h) => names.includes(h));

  const cols = {
    debtor: at(["debtor", "debtor name", "customer", "name", "company"]),
    mc: at(["mc", "mc number", "mc#", "mcnumber"]),
    dot: at(["dot", "usdot", "dot number"]),
    status: at(["status", "credit status", "decision", "result"]),
    limit: at(["limit", "credit limit", "approved limit"]),
    available: at(["available", "availability", "remaining"]),
    reason: at(["reason", "note", "notes", "comment"]),
    conditions: at(["conditions", "terms"]),
    effective: at(["effective", "effective date", "as of"]),
    expiry: at(["expires", "expiry", "expiry date", "good until"]),
  };

  const rows: FactoringImportRowInput[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitRow(lines[i]);
    const value = (index: number) => (index >= 0 ? cells[index]?.trim() || undefined : undefined);
    const debtorName = value(cols.debtor);
    if (!debtorName) continue;
    rows.push({
      lineNumber: i + 1,
      debtorName,
      mcNumber: value(cols.mc),
      dotNumber: value(cols.dot),
      statusText: value(cols.status) ?? "",
      creditLimitText: value(cols.limit),
      availableText: value(cols.available),
      reason: value(cols.reason),
      conditions: value(cols.conditions),
      effectiveDate: value(cols.effective),
      expiryDate: value(cols.expiry),
    });
  }
  return rows;
}

/** Commas, with quoted cells honoured. Nothing fancier is needed here. */
function splitRow(line: string): string[] {
  const out: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === "," && !quoted) {
      out.push(cell);
      cell = "";
    } else {
      cell += ch;
    }
  }
  out.push(cell);
  return out;
}
