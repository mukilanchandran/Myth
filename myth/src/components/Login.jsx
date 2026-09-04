import { useEffect, useState } from 'react';
import { Box, Text, Title, PasswordInput, Group, Stack } from '@mantine/core';
import { IconLock, IconLockOpen } from '@tabler/icons-react';
import { motion } from 'framer-motion';
import { useStore } from '../store/useStore';
import dayjs from 'dayjs';
import { APP_PASSWORD as PASSWORD, asset } from '../config/env';

export default function Login() {
  const login = useStore((s) => s.login);
  const [pw, setPw] = useState('');
  const [error, setError] = useState(false);
  const [unlocking, setUnlocking] = useState(false);

  // auto-validate: unlock the moment the correct password is typed
  useEffect(() => {
    if (pw === PASSWORD) setUnlocking(true);
  }, [pw]);

  useEffect(() => {
    if (!unlocking) return;
    const t = setTimeout(() => login(PASSWORD), 650); // brief unlock animation first
    return () => clearTimeout(t);
  }, [unlocking, login]);

  const onEnter = (e) => {
    if (e.key === 'Enter' && pw !== PASSWORD) {
      setError(true);
      setTimeout(() => setError(false), 1600);
    }
  };

  return (
    <Box className="app-root" style={{ position: 'relative', overflow: 'hidden' }}>
      <div className="bg-photo" style={{ backgroundImage: `url(${asset('bg-login.jpg')})` }} />

      <Box
        style={{
          position: 'relative', zIndex: 2, height: '100%',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        }}
      >
        <motion.div
          initial={{ opacity: 0, y: 28, scale: 0.97 }}
          animate={unlocking ? { opacity: 0, y: -40, scale: 1.04 } : { opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: unlocking ? 0.6 : 0.7, ease: [0.22, 1, 0.36, 1] }}
        >
          <Box className="glass" p={36} w={{ base: '92vw', xs: 420 }} style={{ borderRadius: 28 }}>
            <motion.div animate={error ? { x: [0, -10, 10, -8, 8, 0] } : {}} transition={{ duration: 0.45 }}>
              <Stack gap="lg">
                <Group justify="space-between" align="center">
                  <div>
                    <img src={asset('logo.png')} alt="Myth" style={{ height: 42, display: 'block', borderRadius: '50%' }} />
                    <Text fz={11} c="dimmed" fw={500} tt="uppercase" lts={1} mt={4}>Personal OS</Text>
                  </div>
                  <Text fz={12} c="dimmed" fw={500}>{dayjs().format('ddd, MMM D')}</Text>
                </Group>

                <div>
                  <Title order={2} fw={800} fz={30}>{unlocking ? 'Welcome back' : 'Log in'}</Title>
                  <Text c="dimmed" fz={14} mt={4}>
                    One place for your work, life, goals and growth.
                  </Text>
                </div>

                <PasswordInput
                  size="lg"
                  radius="xl"
                  placeholder="password"
                  value={pw}
                  onChange={(e) => setPw(e.currentTarget.value)}
                  onKeyDown={onEnter}
                  leftSection={
                    unlocking
                      ? <IconLockOpen size={18} color="#12a150" />
                      : <IconLock size={18} />
                  }
                  error={error ? 'Wrong password — keep typing' : null}
                  disabled={unlocking}
                  autoFocus
                  styles={{
                    input: {
                      background: 'rgba(255,255,255,0.65)',
                      border: unlocking ? '1.5px solid #12a150' : '1px solid rgba(255,255,255,0.9)',
                      transition: 'border 200ms ease',
                    },
                  }}
                />

                <Text fz={11.5} c="dimmed" ta="center" lh={1.5}>
                  {unlocking
                    ? 'Unlocked — entering your OS…'
                    : 'Unlocks automatically when the password is right. Your data lives only on this device.'}
                </Text>
              </Stack>
            </motion.div>
          </Box>
        </motion.div>
      </Box>
    </Box>
  );
}
