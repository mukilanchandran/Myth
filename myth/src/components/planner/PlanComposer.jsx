// What lives under the capture bar in Planner mode: a strip of plan types
// (trip, event, study, fitness, food, money, business, website, writing,
// home, career, routine, anything) and a short form for the chosen one.
// One tap on Plan starts the session.
import { useState } from 'react';
import { TextInput, NumberInput, Select, Button, Group } from '@mantine/core';
import { DateInput } from '@mantine/dates';
import {
  IconPlane, IconConfetti, IconSchool, IconRun, IconSalad, IconPigMoney, IconBuildingStore, IconDeviceLaptop, IconPencil, IconHome, IconBriefcase, IconClockHour4, IconSparkles, IconRoute,
} from '@tabler/icons-react';
import dayjs from 'dayjs';
import { useStore } from '../../store/useStore';
import { MODES } from '../../ai/planner';
import { startModeSession, startTripSession } from '../../ai/plannerSession';
import TripComposer from './TripComposer';

export const PLAN_TYPES = [
  { key: 'trip', icon: IconPlane },
  { key: 'event', icon: IconConfetti },
  { key: 'study', icon: IconSchool },
  { key: 'fitness', icon: IconRun },
  { key: 'food', icon: IconSalad },
  { key: 'finance', icon: IconPigMoney },
  { key: 'business', icon: IconBuildingStore },
  { key: 'website', icon: IconDeviceLaptop },
  { key: 'writing', icon: IconPencil },
  { key: 'home', icon: IconHome },
  { key: 'career', icon: IconBriefcase },
  { key: 'routine', icon: IconClockHour4 },
  { key: 'generic', icon: IconSparkles, label: 'Anything' },
];

const LEVELS = ['Beginner', 'Intermediate', 'Advanced'];
// field: { key, label, type: text|date|number|select, placeholder, options, min, max, step, prefix, required, span }
export const MODE_FORMS = {
  event: [
    { key: 'name', label: 'Event', type: 'text', placeholder: "Sister's wedding", required: true },
    { key: 'deadline', label: 'Date', type: 'date', required: true },
    { key: 'guests', label: 'Guests', type: 'number', min: 1, max: 5000, placeholder: '150' },
    { key: 'budget', label: 'Budget (₹)', type: 'number', min: 0, step: 10000, placeholder: '5,00,000' },
    { key: 'kind', label: 'Kind', type: 'select', options: ['Wedding', 'Birthday', 'Party', 'Conference', 'Workshop', 'Reception', 'Housewarming', 'Farewell'] },
  ],
  study: [
    { key: 'name', label: 'Exam / course', type: 'text', placeholder: 'GATE CS 2027', required: true },
    { key: 'deadline', label: 'Exam date', type: 'date', required: true },
    { key: 'hoursPerDay', label: 'Hours a day', type: 'number', min: 0.5, max: 14, step: 0.5, placeholder: '3' },
    { key: 'level', label: 'Where you are', type: 'select', options: LEVELS },
  ],
  fitness: [
    { key: 'name', label: 'Goal', type: 'text', placeholder: 'Half marathon · lose 6 kg · first pull-up', required: true },
    { key: 'deadline', label: 'Target date', type: 'date', required: true },
    { key: 'sessionsPerWeek', label: 'Sessions / week', type: 'number', min: 1, max: 14, placeholder: '4' },
    { key: 'level', label: 'Level', type: 'select', options: LEVELS },
  ],
  food: [
    { key: 'goal', label: 'Goal', type: 'select', options: ['Lose weight', 'Gain muscle', 'Eat healthier', 'More energy', 'Manage sugar', 'Cook on a budget'], required: true },
    { key: 'diet', label: 'Diet', type: 'select', options: ['Vegetarian', 'Non-vegetarian', 'Eggetarian', 'Vegan', 'Keto', 'Jain'], required: true },
    { key: 'days', label: 'Days', type: 'number', min: 3, max: 30, placeholder: '7' },
    { key: 'calories', label: 'Calories / day', type: 'number', min: 800, max: 5000, step: 50, placeholder: '1,800' },
  ],
  finance: [
    { key: 'name', label: 'Goal', type: 'text', placeholder: 'Emergency fund · Goa trip · new laptop', required: true },
    { key: 'amount', label: 'Target (₹)', type: 'number', min: 0, step: 5000, placeholder: '1,00,000', required: true },
    { key: 'deadline', label: 'By', type: 'date', required: true },
    { key: 'monthlyIncome', label: 'Monthly income (₹)', type: 'number', min: 0, step: 5000, placeholder: 'optional' },
  ],
  business: [
    { key: 'name', label: 'Business', type: 'text', placeholder: 'Home bakery · design studio', required: true },
    { key: 'deadline', label: 'Launch by', type: 'date', required: true },
    { key: 'budget', label: 'Budget (₹)', type: 'number', min: 0, step: 10000, placeholder: '2,00,000' },
    { key: 'kind', label: 'Kind', type: 'select', options: ['Online store', 'Shop / café', 'Freelance / agency', 'SaaS / app', 'Consulting', 'Side hustle'] },
  ],
  website: [
    { key: 'name', label: 'Site / app', type: 'text', placeholder: 'My portfolio', required: true },
    { key: 'deadline', label: 'Launch by', type: 'date', required: true },
    { key: 'kind', label: 'Kind', type: 'select', options: ['Portfolio', 'Landing page', 'Blog', 'Web app', 'Mobile app', 'E-commerce'] },
  ],
  writing: [
    { key: 'name', label: 'Title / topic', type: 'text', placeholder: 'A book on design systems', required: true },
    { key: 'kind', label: 'Kind', type: 'select', options: ['Book', 'Blog series', 'Thesis', 'Newsletter', 'Screenplay', 'Research paper'] },
    { key: 'words', label: 'Words', type: 'number', min: 300, max: 300000, step: 500, placeholder: '40,000' },
    { key: 'deadline', label: 'Finish by', type: 'date', required: true },
  ],
  home: [
    { key: 'name', label: 'Project', type: 'text', placeholder: 'Kitchen renovation · moving to Bangalore', required: true },
    { key: 'deadline', label: 'Done by', type: 'date', required: true },
    { key: 'budget', label: 'Budget (₹)', type: 'number', min: 0, step: 10000, placeholder: '3,00,000' },
  ],
  career: [
    { key: 'name', label: 'Target', type: 'text', placeholder: 'Senior product designer at a startup', required: true },
    { key: 'deadline', label: 'By', type: 'date', required: true },
    { key: 'current', label: 'Now', type: 'text', placeholder: 'Product designer, 3 yrs' },
  ],
  routine: [
    { key: 'name', label: 'Routine', type: 'text', placeholder: 'Weekday routine · morning ritual', required: true },
    { key: 'wake', label: 'Wake', type: 'text', placeholder: '06:00' },
    { key: 'sleep', label: 'Sleep', type: 'text', placeholder: '22:30' },
    { key: 'focus', label: 'Must include', type: 'text', placeholder: 'gym, deep work, reading' },
  ],
  generic: [
    { key: 'name', label: 'What are we planning?', type: 'text', placeholder: 'Anything with a finish line', required: true, span: 2 },
    { key: 'deadline', label: 'Done by', type: 'date' },
  ],
};

function Field({ f, value, onChange }) {
  const common = { label: f.label, size: 'sm', radius: 'md', placeholder: f.placeholder };
  if (f.type === 'date') return <DateInput {...common} placeholder={f.placeholder ?? 'Pick a day'} minDate={new Date()} value={value ? dayjs(value).toDate() : null} onChange={(v) => onChange(v ? dayjs(v).format('YYYY-MM-DD') : null)} />;
  if (f.type === 'number') return <NumberInput {...common} min={f.min} max={f.max} step={f.step} thousandSeparator="," value={value ?? ''} onChange={(v) => onChange(v === '' ? null : Number(v))} />;
  if (f.type === 'select') return <Select {...common} placeholder={f.placeholder ?? 'Choose…'} data={f.options} value={value ?? null} onChange={onChange} allowDeselect={false} />;
  return <TextInput {...common} value={value ?? ''} onChange={(e) => onChange(e.currentTarget.value)} />;
}

export default function PlanComposer({ onStart }) {
  const [type, setType] = useState('trip');
  const [form, setForm] = useState({});
  const fields = MODE_FORMS[type] ?? MODE_FORMS.generic;
  const value = (k) => form[`${type}.${k}`];
  const set = (k, v) => setForm((f) => ({ ...f, [`${type}.${k}`]: v }));
  const ready = fields.every((f) => !f.required || (value(f.key) != null && value(f.key) !== ''));
  const meta = MODES[type] ?? MODES.generic;

  const start = () => {
    const input = Object.fromEntries(fields.map((f) => [f.key, value(f.key) ?? null]));
    // food plans are named after the goal and diet; routines after their name
    if (type === 'food') input.name = `${input.diet ?? ''} meal plan — ${input.goal ?? 'eat better'}`.trim();
    if (type === 'food' && !input.deadline) input.deadline = dayjs().add(Math.max(3, input.days ?? 7) + 21, 'day').format('YYYY-MM-DD');
    const session = startModeSession(type, input, useStore);
    onStart?.(session);
  };

  return (
    <div className="plan-composer">
      <Group gap={6} wrap="wrap" className="plan-types">
        {PLAN_TYPES.map((t) => {
            const m = MODES[t.key] ?? MODES.generic;
            const Icon = t.icon;
            const active = t.key === type;
            return (
              <button key={t.key} type="button" className="plan-type" data-active={active || undefined} style={{ '--c': m.color }} onClick={() => setType(t.key)}>
                <Icon size={14} stroke={2} />
                <span>{t.label ?? m.label}</span>
              </button>
            );
          })}
      </Group>

      {type === 'trip' ? (
        <TripComposer onPlan={(input) => onStart?.(startTripSession(input, useStore))} bare />
      ) : (
        <div className="plan-form">
          {fields.map((f) => (
            <div key={f.key} style={{ gridColumn: f.span ? `span ${f.span}` : undefined }}>
              <Field f={f} value={value(f.key)} onChange={(v) => set(f.key, v)} />
            </div>
          ))}
          <Button className="plan-form-go" radius="xl" size="sm" variant="gradient" gradient={{ from: '#f9c04a', to: '#f0a316' }} c="#1a1408" leftSection={<IconRoute size={16} />} disabled={!ready} onClick={start}>
            Plan {meta.label.toLowerCase()}
          </Button>
        </div>
      )}
    </div>
  );
}
