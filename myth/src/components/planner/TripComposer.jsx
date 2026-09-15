// The quick trip form that lives under the capture bar in Planner mode:
// From / To with place autocomplete, dates, travellers — one tap to plan.
import { useState } from 'react';
import { NumberInput, Button, Select } from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { IconRoute, IconFlag, IconMapPinFilled } from '@tabler/icons-react';
import dayjs from 'dayjs';
import { STYLE_META } from '../../ai/planner';
import PlaceInput from '../PlaceInput';

// `bare`: rendered inside the plan composer card (no card chrome of its own)
export default function TripComposer({ onPlan, bare = false }) {
  const [form, setForm] = useState({ from: '', to: '', start: null, end: null, travellers: 2, style: 'balanced' });
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const ready = form.to.trim() && form.start;

  return (
    <div className={`trip-composer${bare ? ' is-bare' : ''}`}>
      <PlaceInput label="From" placeholder="Chennai" value={form.from} onChange={(v) => set({ from: v })} leftSection={<IconMapPinFilled size={14} color="#1971c2" />} />
      <PlaceInput label="To" placeholder="ko… → Kodaikanal" value={form.to} onChange={(v) => set({ to: v })} leftSection={<IconFlag size={14} color="#e03131" />} />
      <DateInput label="Start" size="sm" radius="md" placeholder="Pick a day" minDate={new Date()} value={form.start ? dayjs(form.start).toDate() : null} onChange={(v) => set({ start: v ? dayjs(v).format('YYYY-MM-DD') : null, end: form.end && v && dayjs(form.end).isBefore(dayjs(v)) ? null : form.end })} />
      <DateInput label="End" size="sm" radius="md" placeholder="Same day" minDate={form.start ? dayjs(form.start).toDate() : new Date()} value={form.end ? dayjs(form.end).toDate() : null} onChange={(v) => set({ end: v ? dayjs(v).format('YYYY-MM-DD') : null })} />
      <NumberInput label="People" size="sm" radius="md" min={1} max={20} value={form.travellers} onChange={(v) => set({ travellers: Number(v) || 1 })} />
      <Select label="Style" size="sm" radius="md" allowDeselect={false} value={form.style} onChange={(v) => set({ style: v })} data={Object.entries(STYLE_META).map(([k, v]) => ({ value: k, label: v.name }))} visibleFrom="md" />
      <Button className="trip-composer-go" radius="xl" size="sm" variant="gradient" gradient={{ from: '#f9c04a', to: '#f0a316' }} c="#1a1408" leftSection={<IconRoute size={16} />} disabled={!ready} onClick={() => onPlan({ ...form, end: form.end ?? form.start })}>
        Plan trip
      </Button>
    </div>
  );
}
