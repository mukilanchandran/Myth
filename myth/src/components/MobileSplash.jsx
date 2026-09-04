// Mobile entry: no password, just a short branded splash — then straight in.
// (The desktop keeps its lock screen; on a phone the home-screen icon itself
// is the door, and the password ships in the bundle anyway.)
import { useEffect } from 'react';
import { Box, Text } from '@mantine/core';
import { motion } from 'framer-motion';
import { useStore } from '../store/useStore';
import { asset } from '../config/env';

export default function MobileSplash() {
  const unlock = useStore((s) => s.unlock);

  useEffect(() => {
    const t = setTimeout(unlock, 1600);
    return () => clearTimeout(t);
  }, [unlock]);

  return (
    <Box className="app-root" style={{ position: 'relative', overflow: 'hidden' }}>
      <div className="bg-photo" style={{ backgroundImage: `url(${asset('bg-sunset.jpg')})`, backgroundColor: '#1a1410' }} />
      <Box
        style={{
          position: 'relative', zIndex: 2, height: '100%',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14,
        }}
      >
        <motion.img
          src={asset('logo.png')}
          alt="Myth"
          initial={{ opacity: 0, scale: 0.8, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          style={{ height: 52, borderRadius: '50%', filter: 'drop-shadow(0 4px 18px rgba(0,0,0,0.4))' }}
        />
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.35, duration: 0.6 }}
        >
          <Text fz={12} fw={600} c="rgba(255,255,255,0.85)" tt="uppercase" lts={2} ta="center">
            Personal OS
          </Text>
        </motion.div>
        <motion.div
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ delay: 0.3, duration: 1.2, ease: 'easeInOut' }}
          style={{
            width: 120, height: 3, borderRadius: 2, transformOrigin: 'left',
            background: 'linear-gradient(90deg,#3ddc84,#0f766e)', marginTop: 10,
          }}
        />
      </Box>
    </Box>
  );
}
