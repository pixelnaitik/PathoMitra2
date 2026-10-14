import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'motion/react';
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  deleteDoc,
  doc,
  updateDoc,
  db,
} from '../../data/fs';
import { handleFirestoreError, OperationType } from '../../lib/firestore-errors';
import { cn } from '../../lib/utils';
import { Plus, Stethoscope, Users, Trash2, Edit2 } from 'lucide-react';
import { DEFAULT_DOCTORS } from '../../lib/doctors';
import { readDoctors, readPatients, type DoctorRecord, type PatientRecord } from '../../lib/models';
import { DoctorDetailSheet, type DoctorDetailTarget } from '../../components/DoctorDetailSheet';
import { useAuth } from '../../contexts/AuthContext';
import {
  Button,
  Card,
  IconButton,
  Sheet,
  ConfirmSheet,
  SearchField,
  Field,
  TextInput,
  ListGroup,
  ListRow,
  EmptyState,
  CalendarRangePicker,
  toIsoDay,
} from '../../components/ui';

/** A row in the register: a Firestore doctor, or a seeded default that has no record. */
type DoctorListItem = DoctorRecord & { isDefault?: boolean };

export default function DoctorsPage() {
  const { role } = useAuth();
  const [doctors, setDoctors] = useState<DoctorRecord[]>([]);
  const [patients, setPatients] = useState<PatientRecord[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingDoctor, setEditingDoctor] = useState<DoctorRecord | null>(null);
  const [doctorToDelete, setDoctorToDelete] = useState<DoctorListItem | null>(null);
  const [selectedDoctor, setSelectedDoctor] = useState<DoctorDetailTarget | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    phone: '',
  });

  const activeDoctorDates = useMemo(() => {
    // Local day, matching the calendar grid the dots are painted into.
    return new Set(doctors.filter(d => d.createdAt).map(d => toIsoDay(new Date(d.createdAt))));
  }, [doctors]);

  useEffect(() => {
    const path = 'doctors';
    const q = query(collection(db, path), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(
      q,
      snapshot => {
        // Parsed through the domain model like every other list: a doctor
        // document missing `name` would otherwise crash the search filter
        // below on `undefined.toLowerCase()` and blank the whole page.
        setDoctors(readDoctors(snapshot.docs));
      },
      error => {
        handleFirestoreError(error, OperationType.GET, path);
      },
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const qPatients = query(collection(db, 'patients'));
    const unsubscribePatients = onSnapshot(
      qPatients,
      snapshot => setPatients(readPatients(snapshot.docs)),
      error => handleFirestoreError(error, OperationType.GET, 'patients'),
    );
    return () => unsubscribePatients();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const path = 'doctors';
    try {
      if (editingDoctor) {
        await updateDoc(doc(db, path, editingDoctor.id), {
          ...formData,
        });
      } else {
        await addDoc(collection(db, path), {
          ...formData,
          createdAt: new Date().toISOString(),
        });
      }
      setIsModalOpen(false);
      resetForm();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  };

  const resetForm = () => {
    setFormData({ name: '', phone: '' });
    setEditingDoctor(null);
  };

  const openEditForm = (doctor: DoctorRecord) => {
    setEditingDoctor(doctor);
    setFormData({ name: doctor.name || '', phone: doctor.phone || '' });
    setIsModalOpen(true);
  };

  const allDoctors = useMemo<DoctorListItem[]>(() => {
    const uniqueDynamic = doctors.filter(
      d => !DEFAULT_DOCTORS.some(defaultName => defaultName.toLowerCase() === d.name.toLowerCase()),
    );
    return [
      ...DEFAULT_DOCTORS.map(name => ({
        id: `default_${name}`,
        name,
        phone: '',
        createdAt: new Date().toISOString(),
        isDefault: true,
      })),
      ...uniqueDynamic,
    ];
  }, [doctors]);

  const filteredDoctors = allDoctors.filter(d => {
    const matchesSearch =
      d.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (!!d.phone && d.phone.includes(searchTerm));

    // Compare on the *local* day, the same bucket the calendar dots above use.
    // `toISOString()` here would shift records created before ~05:30 IST into
    // the previous day, so a lit dot could filter to an empty list.
    const matchesDate = (() => {
      if (!d.createdAt) return true;
      const day = toIsoDay(new Date(d.createdAt));
      if (fromDate && day < fromDate) return false;
      if (toDate && day > toDate) return false;
      return true;
    })();

    return matchesSearch && matchesDate;
  });

  const dnameMatches = (n1?: string, n2?: string) => {
    if (!n1 || !n2) return false;
    return n1.trim().toLowerCase() === n2.trim().toLowerCase();
  };

  const getDoctorStats = (doctorName: string) => {
    // Find all patients referred by this doctor
    const referrals = patients.filter(p => dnameMatches(p.doctorName, doctorName));
    const patientsCount = referrals.length;
    // Count total tests across those patients
    const testsCount = referrals.reduce(
      (sum, p) => sum + (p.testSelection ? p.testSelection.length : 0),
      0,
    );
    return { patientsCount, testsCount };
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between gap-4">
        <div className="flex flex-col sm:flex-row flex-1 max-w-lg items-stretch gap-2">
          <SearchField
            className="flex-1"
            placeholder="Search doctors..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            onClear={() => setSearchTerm('')}
            aria-label="Search doctors"
          />

          <CalendarRangePicker
            fromDate={fromDate}
            toDate={toDate}
            activeDates={activeDoctorDates}
            onChange={({ fromDate: from, toDate: to }) => {
              setFromDate(from);
              setToDate(to);
            }}
            className="z-30 w-full sm:w-60"
          />
        </div>
        {role !== 'guest' && (
          <Button
            variant="brand"
            size="lg"
            shine
            onClick={() => setIsModalOpen(true)}
            className="self-start sm:self-auto shrink-0"
          >
            <Plus className="w-5 h-5" />
            Add Doctor
          </Button>
        )}
      </div>

      {filteredDoctors.length === 0 ? (
        // Two different empty states, not one generic. The audit (UI-P1-05)
        // calls out the older copy — "No doctors found. Add a doctor, or
        // adjust your search and date filters." — because the operator reads
        // that as either "the register is empty" or "my filters are too
        // tight" without any way to tell which. The action and the wording
        // now split by state, and the guest role never sees an "Add Doctor"
        // CTA it cannot trigger.
        <Card pad="none">
          {doctors.length === 0 && !searchTerm.trim() && !fromDate && !toDate ? (
            <EmptyState
              icon={<Users className="h-7 w-7" aria-hidden="true" />}
              title="No doctors registered yet"
              description="Add the physicians who refer patients here; the register will start showing their referrals."
              action={
                role !== 'guest' ? (
                  <Button
                    variant="brand"
                    onClick={() => {
                      setIsModalOpen(true);
                    }}
                  >
                    <Plus className="w-4 h-4" aria-hidden="true" />
                    Add first doctor
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <EmptyState
              icon={<Users className="h-7 w-7" aria-hidden="true" />}
              title="No doctor matches the current filters"
              description={`${doctors.length} doctor${doctors.length === 1 ? '' : 's'} in the register, none match this search or date range.`}
              action={
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearchTerm('');
                    setFromDate('');
                    setToDate('');
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          )}
        </Card>
      ) : (
        <>
          <Card pad="none" className="hidden md:block overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-surface-container-low/60 border-b border-outline-variant/40">
                    <th className="px-6 py-3.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-on-surface-variant">
                      Doctor Name
                    </th>
                    <th className="px-6 py-3.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-on-surface-variant">
                      Patients Referred
                    </th>
                    {role !== 'guest' && (
                      <th className="px-6 py-3.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-on-surface-variant text-right">
                        Actions
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/40">
                  {filteredDoctors.map(docItem => {
                    const stats = getDoctorStats(docItem.name);
                    return (
                      <tr
                        key={docItem.id}
                        aria-selected={selectedDoctor?.id === docItem.id}
                        className={cn(
                          'cursor-pointer transition-colors hover:bg-surface-container-low',
                          selectedDoctor?.id === docItem.id &&
                            'bg-accent/8 ring-1 ring-inset ring-accent/40',
                        )}
                        onClick={() =>
                          setSelectedDoctor({
                            id: docItem.id,
                            name: docItem.name,
                            phone: docItem.phone,
                          })
                        }
                      >
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/12 text-accent font-bold">
                              <Stethoscope className="w-5 h-5" />
                            </div>
                            <div>
                              <span className="font-semibold text-on-surface block">
                                {docItem.name}
                              </span>
                              <span className="text-xs text-on-surface-variant">
                                {docItem.phone}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm font-semibold text-on-surface">
                          {stats.patientsCount}
                        </td>
                        {role !== 'guest' && (
                          <td className="px-6 py-4 text-right">
                            <div className="flex justify-end gap-1">
                              {!docItem.isDefault && (
                                <>
                                  <button
                                    onClick={e => {
                                      e.stopPropagation();
                                      openEditForm(docItem);
                                    }}
                                    aria-label={`Edit ${docItem.name}`}
                                    className="rounded-full p-2 text-on-surface-variant transition-colors hover:bg-accent/12 hover:text-accent"
                                  >
                                    <Edit2 className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={e => {
                                      e.stopPropagation();
                                      setDoctorToDelete(docItem);
                                    }}
                                    aria-label={`Delete ${docItem.name}`}
                                    className="rounded-full p-2 text-on-surface-variant transition-colors hover:bg-error-container hover:text-error"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Mobile inset list — staggered entrance. Same shape as the
              patient list: primary button for "open the referral sheet",
              sibling IconButtons for Edit / Delete. Nesting actions inside
              a row-sized `role="button"` wrapper (which this used to be)
              gave TalkBack one announcement instead of three and left
              Tab to walk through an interactive element inside another
              interactive element (UI-P0-04). */}
          <div className="md:hidden">
            <ListGroup>
              {filteredDoctors.map((docItem, dIdx) => {
                const stats = getDoctorStats(docItem.name);
                return (
                  <motion.div
                    key={docItem.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(dIdx * 0.045, 0.45), duration: 0.25 }}
                    className={cn(
                      'transition-colors',
                      selectedDoctor?.id === docItem.id && 'bg-accent/8',
                    )}
                  >
                    <ListRow
                      leading={
                        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/12 text-accent">
                          <Stethoscope className="w-5 h-5" />
                        </span>
                      }
                      title={docItem.name}
                      subtitle={`${stats.patientsCount} patient${stats.patientsCount === 1 ? '' : 's'} referred${docItem.phone ? ` · ${docItem.phone}` : ''}`}
                      primaryLabel={`View ${docItem.name}'s referrals`}
                      onClick={() =>
                        setSelectedDoctor({
                          id: docItem.id,
                          name: docItem.name,
                          phone: docItem.phone,
                        })
                      }
                      trailing={
                        role !== 'guest' && !docItem.isDefault ? (
                          <>
                            <IconButton
                              label={`Edit ${docItem.name}`}
                              size="sm"
                              className="text-on-surface-variant hover:bg-accent/12 hover:text-accent"
                              onClick={e => {
                                e.stopPropagation();
                                openEditForm(docItem);
                              }}
                            >
                              <Edit2 className="w-4 h-4" />
                            </IconButton>
                            <IconButton
                              label={`Delete ${docItem.name}`}
                              size="sm"
                              className="text-on-surface-variant hover:bg-error-container hover:text-error"
                              onClick={e => {
                                e.stopPropagation();
                                setDoctorToDelete(docItem);
                              }}
                            >
                              <Trash2 className="w-4 h-4" />
                            </IconButton>
                          </>
                        ) : undefined
                      }
                    />
                  </motion.div>
                );
              })}
            </ListGroup>
          </div>
        </>
      )}

      {/* Add / edit doctor sheet */}
      <Sheet
        open={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          resetForm();
        }}
        title={editingDoctor ? 'Edit doctor' : 'Add doctor'}
        width="md"
        footer={
          <div className="flex gap-3">
            <Button
              variant="primary"
              size="lg"
              fullWidth
              onClick={() => {
                setIsModalOpen(false);
                resetForm();
              }}
            >
              Cancel
            </Button>
            <Button type="submit" form="doctor-form" variant="brand" size="lg" fullWidth>
              {editingDoctor ? 'Save Changes' : 'Add Doctor'}
            </Button>
          </div>
        }
      >
        <form id="doctor-form" onSubmit={handleSubmit} className="space-y-4 py-1">
          <Field label="Doctor Name" required>
            <TextInput
              required
              type="text"
              value={formData.name}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
              placeholder="Dr. Rahul Pande"
            />
          </Field>
          <Field label="Phone Number" hint="Optional">
            <TextInput
              type="tel"
              value={formData.phone}
              onChange={e => setFormData({ ...formData, phone: e.target.value })}
              placeholder="+91 98765 43210"
            />
          </Field>
        </form>
      </Sheet>

      <ConfirmSheet
        open={!!doctorToDelete}
        onClose={() => setDoctorToDelete(null)}
        title="Delete Doctor"
        message={`Are you sure you want to delete ${doctorToDelete?.name}? This action cannot be undone.`}
        onConfirm={async () => {
          if (!doctorToDelete) return;
          const path = 'doctors';
          try {
            await deleteDoc(doc(db, path, doctorToDelete.id));
            setDoctorToDelete(null);
          } catch (err) {
            handleFirestoreError(err, OperationType.DELETE, path);
          }
        }}
      />

      {/* Date-filtered referral profile for the selected doctor */}
      <DoctorDetailSheet
        key={selectedDoctor?.id ?? 'none'}
        doctor={selectedDoctor}
        patients={patients}
        initialFrom={fromDate}
        initialTo={toDate}
        onClose={() => setSelectedDoctor(null)}
      />
    </div>
  );
}
