"use client";

import { useState, useTransition, type FormEvent } from "react";
import toast from "react-hot-toast";
import { COLORS } from "@/components/layout/theme";
import MasterDataModal from "@/components/ui/MasterDataModal";
import { Field, SelectInput } from "@/components/purchases/form-fields";
import { MAX_SEATS } from "../../schemas/table";
import { GUEST_NAME_MAX, GUEST_PHONE_MAX, type ReservationField } from "../../schemas/reservation";
import { createReservation } from "../../server/actions/reservations";
import type { BookingCustomer, BookingTable } from "../../server/queries/reservations";
import { DateField, TimeField } from "../DateTimeInputs";
import TextInput from "../TextInput";

const grid = (columns: number) => ({ display: "grid", gridTemplateColumns: `repeat(${columns}, minmax(0,1fr))`, gap: 14 }) as const;

// New booking (shared modal shell): an existing customer or a typed name and
// phone, party size, date and time, then a table — only tables in the chosen
// area with enough seats are offered. The server re-checks everything and
// applies the no-double-booking rule.
export default function BookingModal({
  tables,
  customers,
  defaultDay,
  today,
  onBooked,
  onClose,
}: {
  tables: BookingTable[];
  customers: BookingCustomer[];
  defaultDay: string;
  today: string;
  // The booked day (the panel shows it).
  onBooked: (day: string) => void;
  onClose: () => void;
}) {
  const [customerId, setCustomerId] = useState("");
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [partySize, setPartySize] = useState("2");
  const [date, setDate] = useState(defaultDay < today ? today : defaultDay);
  const [time, setTime] = useState("");
  const [areaId, setAreaId] = useState(() => tables[0]?.areaId ?? "");
  const [tableId, setTableId] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<ReservationField, string[]>>>({});
  const [isPending, startTransition] = useTransition();

  const customer = customers.find((c) => c.id === customerId);
  const party = /^\d+$/.test(partySize) ? Number(partySize) : 0;
  const areas = [...new Map(tables.map((t) => [t.areaId, t.areaName])).entries()];
  const fitting = tables.filter((t) => t.areaId === areaId && t.seats >= party);
  // A table that no longer fits (party or area changed) is unselected.
  const chosenTable = fitting.some((t) => t.id === tableId) ? tableId : "";

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending) return;
    setFieldErrors({});
    startTransition(async () => {
      const result = await createReservation({
        customerId,
        guestName: customer ? "" : guestName,
        guestPhone: customer ? "" : guestPhone,
        partySize: party || partySize,
        date,
        time,
        tableId: chosenTable,
      });
      if (result.ok) {
        const table = tables.find((t) => t.id === chosenTable);
        toast.success(`Booked ${customer?.name ?? guestName.trim()} at ${table?.name ?? "the table"}, ${time}.`);
        onBooked(date);
        onClose();
      } else {
        setFieldErrors(result.fieldErrors ?? {});
        toast.error(result.error);
      }
    });
  }

  return (
    <MasterDataModal title="New booking" onClose={onClose} onSubmit={handleSubmit} submitting={isPending} submitLabel="Book table" width={540}>
      <Field label="Customer" error={fieldErrors.customerId?.[0]}>
        <SelectInput
          value={customerId}
          onChange={setCustomerId}
          options={customers.map((c) => ({ value: c.id, label: c.name }))}
          placeholder="New guest — type their name and phone"
          hasError={!!fieldErrors.customerId}
        />
      </Field>
      {customer ? (
        <p style={{ margin: "-6px 0 0", fontSize: 12.5, color: COLORS.slateMid }}>
          Booking for {customer.name} · {customer.phone}
        </p>
      ) : (
        <div style={grid(2)}>
          <Field label="Guest name" required error={fieldErrors.guestName?.[0]}>
            <TextInput value={guestName} onChange={setGuestName} placeholder="e.g. Okafor" maxLength={GUEST_NAME_MAX} hasError={!!fieldErrors.guestName} ariaLabel="Guest name" />
          </Field>
          <Field label="Phone" required error={fieldErrors.guestPhone?.[0]}>
            <TextInput value={guestPhone} onChange={setGuestPhone} placeholder="0803 214 7781" maxLength={GUEST_PHONE_MAX} hasError={!!fieldErrors.guestPhone} ariaLabel="Phone" />
          </Field>
        </div>
      )}

      <div style={grid(3)}>
        <Field label="Party size" required error={fieldErrors.partySize?.[0]}>
          <TextInput
            value={partySize}
            onChange={(value) => setPartySize(value.replace(/\D/g, "").slice(0, 2))}
            placeholder={`1–${MAX_SEATS}`}
            hasError={!!fieldErrors.partySize}
            ariaLabel="Party size"
            inputMode="numeric"
          />
        </Field>
        <Field label="Date" required error={fieldErrors.date?.[0]}>
          <DateField value={date} onChange={setDate} min={today} hasError={!!fieldErrors.date} ariaLabel="Date" />
        </Field>
        <Field label="Time" required error={fieldErrors.time?.[0]}>
          <TimeField value={time} onChange={setTime} hasError={!!fieldErrors.time} ariaLabel="Time" />
        </Field>
      </div>

      <div style={grid(2)}>
        <Field label="Area" required>
          <SelectInput value={areaId} onChange={setAreaId} options={areas.map(([value, label]) => ({ value, label }))} placeholder="Choose area" />
        </Field>
        <Field label="Table" required error={fieldErrors.tableId?.[0]}>
          <SelectInput
            value={chosenTable}
            onChange={setTableId}
            options={fitting.map((t) => ({ value: t.id, label: `${t.name} · ${t.seats} seats` }))}
            placeholder={!areaId ? "Choose an area first" : fitting.length ? "Choose table" : "No table fits this party"}
            hasError={!!fieldErrors.tableId}
          />
        </Field>
      </div>
    </MasterDataModal>
  );
}
