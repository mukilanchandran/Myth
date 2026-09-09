import { useState } from 'react';
import {
  Stack, Group, Text, ActionIcon, TextInput, Button, Box, NumberInput, Select,
  SegmentedControl, Badge,
} from '@mantine/core';
import { IconPlus, IconTrash, IconTrendingUp, IconTrendingDown, IconPigMoney } from '@tabler/icons-react';
import { DonutChart } from '@mantine/charts';
import dayjs from 'dayjs';
import { useStore } from '../../store/useStore';

const CATEGORIES = ['Food', 'Groceries', 'Transport', 'Home & Bills', 'Entertainment', 'Health', 'Shopping', 'Learning', 'Salary', 'Other'];
const COLORS = ['#0D2D1C', '#1971c2', '#e8590c', '#7048e8', '#f08c00', '#e03131', '#0ca678', '#845ef7', '#3bc9db', '#868e96'];

export default function FinancePanel() {
  const { transactions, addTransaction, deleteTransaction } = useStore();
  const [type, setType] = useState('expense');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('Food');
  const [note, setNote] = useState('');

  const month = transactions.filter((t) => dayjs(t.date).isSame(dayjs(), 'month'));
  const spent = month.filter((t) => t.type === 'expense').reduce((a, t) => a + t.amount, 0);
  const earned = month.filter((t) => t.type === 'income').reduce((a, t) => a + t.amount, 0);

  const byCat = {};
  month.filter((t) => t.type === 'expense').forEach((t) => { byCat[t.category] = (byCat[t.category] ?? 0) + t.amount; });
  const donut = Object.entries(byCat).map(([name, value], i) => ({ name, value, color: COLORS[i % COLORS.length] }));

  const add = () => {
    if (!amount) return;
    addTransaction({ type, amount: Number(amount), category, note });
    setAmount(''); setNote('');
  };

  const stat = (label, value, icon, color) => (
    <Box className="glass" p="md" style={{ borderRadius: 16, flex: 1 }}>
      <Group gap={8}>{icon}<Text fz={12.5} c="dimmed" fw={600}>{label}</Text></Group>
      <Text fz={20} fw={800} c={color}>₹{value.toLocaleString('en-IN')}</Text>
    </Box>
  );

  return (
    <Stack gap="md">
      <Group gap="sm" grow>
        {stat('Income', earned, <IconTrendingUp size={16} color="#0D2D1C" />, '#0D2D1C')}
        {stat('Spent', spent, <IconTrendingDown size={16} color="#e03131" />, '#c92a2a')}
        {stat('Net', earned - spent, <IconPigMoney size={16} color="#1971c2" />, earned - spent >= 0 ? '#0D2D1C' : '#c92a2a')}
      </Group>

      {donut.length > 0 && (
        <Box className="glass" p="md" style={{ borderRadius: 16 }}>
          <Text fw={700} fz={14} mb="xs">{dayjs().format('MMMM')} spending by category</Text>
          <Group justify="center">
            <DonutChart data={donut} size={160} thickness={26} withTooltip tooltipDataSource="segment" />
            <Stack gap={4}>
              {donut.slice(0, 6).map((d) => (
                <Group key={d.name} gap={6}>
                  <Box w={10} h={10} style={{ borderRadius: 5, background: d.color }} />
                  <Text fz={12.5}>{d.name}</Text>
                  <Text fz={12.5} fw={700}>₹{d.value.toLocaleString('en-IN')}</Text>
                </Group>
              ))}
            </Stack>
          </Group>
        </Box>
      )}

      <Box className="glass" p="md" style={{ borderRadius: 16 }}>
        <SegmentedControl
          value={type} onChange={setType} radius="xl" size="xs" mb="sm" fullWidth
          data={[{ value: 'expense', label: 'Expense' }, { value: 'income', label: 'Income' }]}
        />
        <Group gap="xs" wrap="wrap">
          <NumberInput radius="xl" placeholder="Amount ₹" hideControls w={110} value={amount} onChange={setAmount} />
          <Select radius="xl" data={CATEGORIES} value={category} onChange={setCategory} w={140} />
          <TextInput radius="xl" placeholder="Note" style={{ flex: 1, minWidth: 150 }} value={note} onChange={(e) => setNote(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
          <ActionIcon size={36} radius="xl" variant="filled" color="forest" onClick={add}><IconPlus size={18} /></ActionIcon>
        </Group>
        <Text fz={11.5} c="dimmed" mt={6}>Tip: just type "spent 250 on lunch" in the landing capture bar — it lands here automatically.</Text>
      </Box>

      <Stack gap={0}>
        {[...transactions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30).map((t) => (
          <Group key={t.id} gap={8} wrap="nowrap" px={4} py={7} style={{ borderBottom: '1px solid rgba(20,60,40,0.07)' }}>
            <Text fz={11.5} c="dimmed" w={46} style={{ flexShrink: 0 }}>{dayjs(t.date).format('MMM D')}</Text>
            <Box style={{ flex: 1, minWidth: 0 }}>
              <Text fz={13} lineClamp={1}>{t.note || t.category}</Text>
              <Badge size="xs" variant="light" mt={2}>{t.category}</Badge>
            </Box>
            <Text fz={13} fw={700} c={t.type === 'income' ? 'green' : 'red'} style={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
              {t.type === 'income' ? '+' : '−'}₹{t.amount.toLocaleString('en-IN')}
            </Text>
            <ActionIcon size="sm" variant="subtle" color="red" onClick={() => deleteTransaction(t.id)}><IconTrash size={13} /></ActionIcon>
          </Group>
        ))}
      </Stack>
    </Stack>
  );
}
