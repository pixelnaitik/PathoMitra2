/**
 * Cascading deletes for the relational local model.
 *
 * A report owns a staff note; a patient owns reports and invoices. Everything
 * goes through these two functions so the behaviour is defined once, is applied
 * in committed chunks, and never touches a document the user did not ask to
 * remove. Backed by the on-device store via `data/fs` — no Firestore.
 */
import { collection, db, doc, getDocs, query, where } from '../data/fs';
import { deleteInChunks } from './firestore-batch';

/**
 * Remove a report, its staff note, its amendment history, and any invoice raised
 * for it. The patient record is deliberately left alone. History is removed with
 * the report so a deleted report leaves no recoverable clinical copy behind.
 */
export async function deleteReportCascade(reportId: string): Promise<void> {
  const [invoices, versions] = await Promise.all([
    getDocs(query(collection(db, 'invoices'), where('reportId', '==', reportId))),
    getDocs(query(collection(db, 'reportVersions'), where('reportId', '==', reportId))),
  ]);

  await deleteInChunks([
    doc(db, 'reports', reportId),
    doc(db, 'reportNotes', reportId),
    ...versions.docs.map(versionDoc => versionDoc.ref),
    ...invoices.docs.map(invoiceDoc => invoiceDoc.ref),
  ]);
}

/**
 * Remove a patient and every document that belongs to them: their reports,
 * those reports' staff notes and amendment history, and their invoices.
 */
export async function deletePatientCascade(patientId: string): Promise<void> {
  const [reports, invoices, versions] = await Promise.all([
    getDocs(query(collection(db, 'reports'), where('patientId', '==', patientId))),
    getDocs(query(collection(db, 'invoices'), where('patientId', '==', patientId))),
    getDocs(query(collection(db, 'reportVersions'), where('patientId', '==', patientId))),
  ]);

  await deleteInChunks([
    doc(db, 'patients', patientId),
    ...reports.docs.map(reportDoc => reportDoc.ref),
    ...reports.docs.map(reportDoc => doc(db, 'reportNotes', reportDoc.id)),
    ...versions.docs.map(versionDoc => versionDoc.ref),
    ...invoices.docs.map(invoiceDoc => invoiceDoc.ref),
  ]);
}
