// A text field that suggests place names as you type ("ko" → Kodaikanal,
// Kochi, Kolkata…). Picking fills the field with the short name; the full
// label is shown in the list so Goa (India) is not confused with Genoa.
import { useEffect, useRef, useState } from 'react';
import { Combobox, TextInput, useCombobox, Loader, Text, Group } from '@mantine/core';
import { IconMapPin } from '@tabler/icons-react';
import { suggestPlaces } from '../ai/placeSearch';

export default function PlaceInput({ value, onChange, onPick, label, placeholder, size = 'sm', radius = 'md', leftSection, style, variant, ...rest }) {
  const combobox = useCombobox({ onDropdownClose: () => combobox.resetSelectedOption() });
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const timer = useRef(null);
  const latest = useRef('');

  useEffect(() => () => clearTimeout(timer.current), []);

  const search = (q) => {
    clearTimeout(timer.current);
    latest.current = q;
    if (q.trim().length < 2) { setItems([]); setBusy(false); combobox.closeDropdown(); return; }
    setBusy(true);
    timer.current = setTimeout(async () => {
      const list = await suggestPlaces(q);
      if (latest.current !== q) return; // a newer keystroke won
      setItems(list);
      setBusy(false);
      if (list.length) combobox.openDropdown(); else combobox.closeDropdown();
    }, 220);
  };

  return (
    <Combobox
      store={combobox} withinPortal position="bottom-start" radius="md" shadow="md" width={320}
      onOptionSubmit={(val) => {
        const p = items.find((i) => i.label === val);
        if (p) { onChange?.(p.name); onPick?.(p); }
        combobox.closeDropdown();
      }}
    >
      <Combobox.Target>
        <TextInput
          label={label} placeholder={placeholder} size={size} radius={radius} style={style} variant={variant}
          leftSection={leftSection === null ? undefined : (leftSection ?? <IconMapPin size={15} />)}
          rightSection={busy ? <Loader size={12} color="forest" /> : null}
          value={value ?? ''}
          onChange={(e) => { const v = e.currentTarget.value; onChange?.(v); search(v); }}
          onFocus={() => { if (items.length) combobox.openDropdown(); }}
          onBlur={() => combobox.closeDropdown()}
          autoComplete="off"
          {...rest}
        />
      </Combobox.Target>
      <Combobox.Dropdown>
        <Combobox.Options>
          {items.map((p) => (
            <Combobox.Option key={p.label} value={p.label}>
              <Group gap={8} wrap="nowrap">
                <IconMapPin size={14} color="#1b5a38" style={{ flexShrink: 0 }} />
                <div style={{ minWidth: 0 }}>
                  <Text fz={13} fw={600} lineClamp={1}>{p.name}</Text>
                  <Text fz={11} c="dimmed" lineClamp={1}>{p.label}</Text>
                </div>
              </Group>
            </Combobox.Option>
          ))}
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  );
}
