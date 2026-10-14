/**
 * Domain models for the Firestore documents the UI reads and writes.
 *
 * Before this layer every collection was consumed as `any[]`, so a renamed or
 * mistyped field surfaced as `undefined` somewhere deep in a table render (or,
 * for a report, silently changed the signed payload). Each entity now has:
 *
 *   - a schema, mirroring the guarantees already made in `firestore.rules`;
 *   - a `read*()` parser used at the Firestore boundary — it never throws, logs
 *     through `captureError`, and degrades to a displayable stub so one bad
 *     document cannot blank a whole list;
 *   - a `to*()` builder used on writes, so the document shape is defined once.
 *
 * The schemas are deliberately *loose* about unknown keys: legacy documents
 * carry fields that newer code no longer writes, and rejecting those would lose
 * real patient records. Known fields are still validated.
 */
import { z } from 'zod';
import { captureError } from './telemetry';

/** ISO-8601 written by the client today; see also `serverTimestamp` migration. */
const timestampString = z.string().max(64);

export const RoleSchema = z.enum(['guest', 'staff', 'admin']);
export type Role = z.infer<typeof RoleSchema>;

export const GenderSchema = z.enum(['male', 'female', 'other']);
export type Gender = z.infer<typeof GenderSchema>;

/**
 * `draft` = still being composed and unsigned. `final` = signed and issued, so
 * its result table is immutable without an amendment entry. Neither is visible
 * to a patient: the app has no public read surface — a report leaves the device
 * only as a PDF a member of staff hands over.
 */
export const ReportStatusSchema = z.enum(['draft', 'final']);
export type ReportStatus = z.infer<typeof ReportStatusSchema>;

export const InvoiceStatusSchema = z.enum(['pending', 'paid']);
export type InvoiceStatus = z.infer<typeof InvoiceStatusSchema>;

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export const UserSchema = z.looseObject({
  name: z.string().max(100).default(''),
  email: z.string().max(100).default(''),
  role: RoleSchema.default('guest'),
  createdAt: timestampString.default(''),
  avatarSeed: z.string().max(500).optional(),
});
export type UserProfile = z.infer<typeof UserSchema> & { id: string };

// ---------------------------------------------------------------------------
// Patients
// ---------------------------------------------------------------------------

/**
 * `age` stays a union: historical documents store it as a string while newer
 * writes store a number. Use {@link ageAsNumber} instead of branching inline.
 */
export const PatientSchema = z.looseObject({
  name: z.string().max(100).default(''),
  age: z.union([z.number().int().min(0).max(150), z.string().max(4)]).default('0'),
  gender: z.string().max(10).default('other'),
  phone: z.string().max(20).optional(),
  doctorName: z.string().max(100).optional(),
  address: z.string().max(500).optional(),
  testSelection: z.array(z.string().max(128)).max(200).optional(),
  createdAt: timestampString.default(''),
});
export type PatientRecord = z.infer<typeof PatientSchema> & { id: string };

/** Numeric age, or `undefined` when the stored value is not a sane number. */
export function ageAsNumber(patient: Pick<PatientRecord, 'age'>): number | undefined {
  const n = typeof patient.age === 'number' ? patient.age : parseInt(patient.age, 10);
  return Number.isFinite(n) && n >= 0 && n <= 150 ? n : undefined;
}

/**
 * Who to attribute a write to.
 *
 * The local account's `uid` is the fixed string `local-admin` (AuthContext), so
 * storing it alone records nothing a human can read on an audit line — the
 * display name is the readable operator, and `uid` is the fallback for a session
 * that somehow has no name. Never write the raw `uid` at a call site again.
 */
export function operatorStamp(
  user?: { uid?: string | null; displayName?: string | null } | null,
): string {
  const name = (user?.displayName ?? '').trim();
  return name || user?.uid || 'unknown';
}

/**
 * Write builder for `patients/{id}` — the counterpart of `toReportDoc`.
 *
 * Patient writes used to persist the form object verbatim, so the shape of a
 * clinical record was decided by whichever screen saved last, and a stray form
 * field or a `NaN` age went straight into the encrypted store. Everything the
 * UI saves crosses `PatientSchema` here first, and the schema guarantees the
 * bounds the rest of the app already assumes (`age` 0-150, whole years).
 */
export interface PatientDraftInput {
  name: string;
  /** Raw form value — numeric string, number, or empty.
   */
  age: string | number;
  gender: string;
  phone?: string;
  doctorName?: string;
  address?: string;
  testSelection?: string[];
  createdAt?: string;
}

/** Input for {@link toPatientUpdateDoc} — same fields, no `createdAt`. */
export type PatientPatchInput = Omit<PatientDraftInput, 'createdAt'>;

/** Shared construction for both patient write builders. */
function patientDocFields(input: PatientDraftInput): Record<string, unknown> {
  const parsed = Number.parseInt(String(input.age ?? '').trim(), 10);
  const doc: Record<string, unknown> = {
    name: input.name.trim(),
    age: Number.isFinite(parsed) ? Math.min(150, Math.max(0, parsed)) : 0,
    gender: input.gender,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
  const phone = (input.phone ?? '').trim();
  if (phone) doc.phone = phone;
  const doctorName = (input.doctorName ?? '').trim();
  if (doctorName) doc.doctorName = doctorName;
  const address = (input.address ?? '').trim();
  if (address) doc.address = address;
  doc.testSelection = (input.testSelection ?? []).map(name => name.trim()).filter(Boolean);

  // Final validation against the schema; a value the schema rejects is a bug at
  // the call site, so this throws rather than writing a document the readers will
  // have to stub.
  return PatientSchema.parse(doc) as Record<string, unknown>;
}

/** Build the exact document stored in `patients/{id}`. */
export function toPatientDoc(input: PatientDraftInput): Record<string, unknown> {
  return patientDocFields({
    ...input,
    createdAt: input.createdAt || new Date().toISOString(),
  });
}

/**
 * Build the update payload for an existing patient.
 *
 * `createdAt` is dropped from the result on purpose: the registration date is
 * what the overdue alerts and the analytics window measure against, and the
 * schema's default would otherwise stamp an empty date over the real one.
 */
export function toPatientUpdateDoc(input: PatientPatchInput): Record<string, unknown> {
  const { createdAt: _registrationDate, ...editable } = patientDocFields({
    ...input,
    createdAt: '',
  });
  return editable;
}

// ---------------------------------------------------------------------------
// Doctors (referral register)
// ---------------------------------------------------------------------------

export const DoctorSchema = z.looseObject({
  name: z.string().max(100).default(''),
  phone: z.string().max(20).optional(),
  createdAt: timestampString.default(''),
});
export type DoctorRecord = z.infer<typeof DoctorSchema> & { id: string };

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export const ReportSchema = z.looseObject({
  patientId: z.string().max(128),
  patientName: z.string().max(100).default(''),
  resultData: z.record(z.string(), z.unknown()).default({}),
  signature: z.string().max(128).default(''),
  // No default. A missing or unknown status used to fall through to `final`, so
  // a malformed historical document was silently presented — and printable — as
  // an issued clinical report. `readReport` normalises the status to a reviewable
  // draft instead; see {@link normalizeReportStatus}.
  status: ReportStatusSchema,
  createdAt: timestampString.default(''),
  createdBy: z.string().max(128).default(''),
  testType: z.string().max(128).optional(),
  testSelection: z.array(z.string().max(128)).max(200).optional(),

  /** Audit trail: set when a final report is amended. */
  version: z.number().int().min(1).default(1),
  updatedBy: z.string().max(128).optional(),
  updatedAt: timestampString.optional(),
  amendReason: z.string().max(500).optional(),

  /**
   * True when the stored status was missing or unrecognised, so the record was
   * forced into `draft` to keep it inspectable without letting it issue, share or
   * print as a validated final report. The operator must re-verify before use.
   */
  needsReview: z.boolean().optional(),
});
export type ReportRecord = z.infer<typeof ReportSchema> & { id: string };

/**
 * Coerce a stored report's `status` into the validated domain *before* parsing,
 * without throwing away the fields a malformed record still carries.
 *
 * A document whose status is absent or not a known value is not deleted or
 * stubbed — the results, patient link and timestamps are kept so the record
 * remains recoverable — but it is downgraded to `draft` and flagged
 * `needsReview`, which is the only safe reading of "we cannot tell what this
 * was." It can then never issue, share, or print as a final report until an
 * operator re-validates it. Returns the input untouched for a genuine object so
 * a valid report pays no cost.
 */
export function normalizeReportStatus(data: unknown): unknown {
  if (typeof data !== 'object' || data === null) return data;
  const record = data as Record<string, unknown>;
  if (record.status === 'draft' || record.status === 'final') return record;
  return { ...record, status: 'draft', needsReview: true };
}

/** Payload accepted by the report write path. */
export interface ReportDraftInput {
  id?: string;
  patientId: string;
  patientName: string;
  resultData: Record<string, unknown>;
  signature: string;
  status: ReportStatus;
  createdAt: string;
  createdBy: string;
  testType?: string;
  testSelection?: string[];
  version?: number;
  updatedBy?: string;
  updatedAt?: string;
  amendReason?: string;
}

/** Build the exact document stored in `reports/{id}`. */
export function toReportDoc(input: ReportDraftInput): Record<string, unknown> {
  const doc: Record<string, unknown> = {
    patientId: input.patientId,
    patientName: input.patientName,
    resultData: input.resultData,
    signature: input.signature,
    status: input.status,
    createdAt: input.createdAt,
    createdBy: input.createdBy,
    version: input.version ?? 1,
  };
  if (input.testType) doc.testType = input.testType;
  if (input.testSelection) doc.testSelection = input.testSelection;
  if (input.updatedBy) doc.updatedBy = input.updatedBy;
  if (input.updatedAt) doc.updatedAt = input.updatedAt;
  if (input.amendReason) doc.amendReason = input.amendReason;
  return doc;
}

/** The fields that may be amended on an existing report (author is immutable). */
export function toReportUpdateDoc(
  input: ReportDraftInput,
  existingVersion: number,
): Record<string, unknown> {
  const { createdBy: _createdBy, ...rest } = toReportDoc(input);
  return { ...rest, version: Math.max(1, existingVersion + 1) };
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

export const InvoiceSchema = z.looseObject({
  reportId: z.string().max(128).default(''),
  patientId: z.string().max(128).default(''),
  patientName: z.string().max(100).default(''),
  amount: z.coerce.number().min(0).max(10_000_000).default(0),
  status: InvoiceStatusSchema.default('pending'),
  createdAt: timestampString.default(''),
});
export type InvoiceRecord = z.infer<typeof InvoiceSchema> & { id: string };

// ---------------------------------------------------------------------------
// Boundary readers
// ---------------------------------------------------------------------------

/**
 * Shared read helper: validate, and on failure log the mismatch and fall back to
 * whatever the document *did* provide so lists stay usable. A strict throw here
 * would mean one malformed record makes an entire page unusable.
 */
function readAtBoundary<T>(
  schema: z.ZodType<T>,
  label: string,
  id: string,
  data: unknown,
  fallback: T,
): T & { id: string } {
  const result = schema.safeParse(data ?? {});
  if (result.success) {
    return { ...(result.data as T), id };
  }
  captureError(new Error(`Malformed ${label} document: ${id}`), {
    scope: `models/${label}`,
    issues: result.error.issues
      .slice(0, 3)
      .map(issue => `${issue.path.join('.')}: ${issue.message}`)
      .join('; '),
  });
  return { ...fallback, id };
}

export function readUser(id: string, data: unknown): UserProfile {
  return readAtBoundary(UserSchema, 'user', id, data, {
    name: 'Unknown user',
    email: '',
    role: 'guest',
    createdAt: '',
  });
}

export function readPatient(id: string, data: unknown): PatientRecord {
  return readAtBoundary(PatientSchema, 'patient', id, data, {
    name: `Unsaved record (${id.slice(0, 6)})`,
    age: 0,
    gender: 'other',
    createdAt: '',
  });
}

export function readDoctor(id: string, data: unknown): DoctorRecord {
  return readAtBoundary(DoctorSchema, 'doctor', id, data, {
    name: `Unknown doctor (${id.slice(0, 6)})`,
    createdAt: '',
  });
}

export function readReport(id: string, data: unknown): ReportRecord {
  // Normalise the status first so a missing/unknown value keeps the rest of the
  // document (recoverable) and lands in a reviewable draft, never a silent final.
  const status =
    data && typeof data === 'object' && (data as { status?: unknown }).status === 'final'
      ? ('final' as const)
      : ('draft' as const);
  return readAtBoundary(ReportSchema, 'report', id, normalizeReportStatus(data), {
    patientId: '',
    patientName: `Report ${id.slice(0, 6)}`,
    resultData: {},
    signature: '',
    status,
    createdAt: '',
    createdBy: '',
    version: 1,
    needsReview: true,
  });
}

export function readInvoice(id: string, data: unknown): InvoiceRecord {
  return readAtBoundary(InvoiceSchema, 'invoice', id, data, {
    reportId: '',
    patientId: '',
    patientName: '',
    amount: 0,
    status: 'pending',
    createdAt: '',
  });
}

/** Convenience for `snapshot.docs.map(...)`. Accepts a Firestore doc array directly. */
type FirestoreDocs = readonly { id: string; data: () => unknown }[];

/**
 * The plural helpers are what list pages pass to `useCollectionList`'s `map`,
 * so every document crosses the schema boundary before it reaches a render.
 * Only collections that are actually listed here have a plural form: `users`
 * is read one document at a time (the caller's own profile), so it has no
 * list helper.
 */
export function readPatients(docs: FirestoreDocs): PatientRecord[] {
  return docs.map(d => readPatient(d.id, d.data()));
}
export function readReports(docs: FirestoreDocs): ReportRecord[] {
  return docs.map(d => readReport(d.id, d.data()));
}
export function readDoctors(docs: FirestoreDocs): DoctorRecord[] {
  return docs.map(d => readDoctor(d.id, d.data()));
}
export function readInvoices(docs: FirestoreDocs): InvoiceRecord[] {
  return docs.map(d => readInvoice(d.id, d.data()));
}
