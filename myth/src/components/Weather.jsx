import { useEffect, useState } from 'react';
import { Box, Group, Text, Modal, Stack, SimpleGrid, Loader, Button, Divider } from '@mantine/core';
import { IconMapPin, IconWind, IconDroplet, IconTemperature, IconSunrise, IconSunset, IconCurrentLocation } from '@tabler/icons-react';
import dayjs from 'dayjs';
import { fetchWeather, weatherMeta, DEFAULT_LOCATION } from '../weather';

export default function WeatherChip() {
  const [data, setData] = useState(null);
  const [loc, setLoc] = useState(DEFAULT_LOCATION);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = async (l = loc) => {
    try {
      setFailed(false);
      const d = await fetchWeather(l.lat, l.lon);
      setData(d);
    } catch {
      setFailed(true);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(() => load(), 30 * 60 * 1000); // refresh every 30 min
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc]);

  const useMyLocation = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setLoc({ name: 'My location', lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => {}
    );
  };

  if (failed || !data) {
    return null; // stay quiet when offline — weather is a bonus, never a blocker
  }

  const cur = data.current;
  const meta = weatherMeta(cur.weather_code);
  const MIcon = meta.icon;

  // next 12 hours starting now
  const nowIdx = data.hourly.time.findIndex((t) => dayjs(t).isAfter(dayjs().subtract(1, 'hour')));
  const hours = data.hourly.time.slice(nowIdx, nowIdx + 12).map((t, i) => ({
    t,
    temp: data.hourly.temperature_2m[nowIdx + i],
    code: data.hourly.weather_code[nowIdx + i],
    rain: data.hourly.precipitation_probability?.[nowIdx + i],
  }));

  return (
    <>
      <Box
        onClick={() => setOpen(true)}
        px={12} py={6}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', borderRadius: 999,
          background: '#fff', boxShadow: '0 8px 26px rgba(20,45,33,0.08)', transition: 'transform 140ms ease',
        }}
        className="dock-btn"
      >
        <MIcon size={18} color={meta.color} />
        <Text c="#0f1f17" fw={700} fz={14}>{Math.round(cur.temperature_2m)}°</Text>
      </Box>

      <Modal
        opened={open} onClose={() => setOpen(false)} size="md" radius="xl" centered
        title={
          <Group gap={8}>
            <IconMapPin size={18} color="#0D2D1C" />
            <Text fw={800} fz={17}>{loc.name}</Text>
          </Group>
        }
      >
        {!data ? (
          <Group justify="center" py="xl"><Loader color="forest" /></Group>
        ) : (
          <Stack gap="lg">
            {/* current */}
            <Group align="center" gap="xl" justify="center" py="sm">
              <MIcon size={72} color={meta.color} stroke={1.4} />
              <div>
                <Text fz={46} fw={900} lh={1}>{Math.round(cur.temperature_2m)}°C</Text>
                <Text fz={14} c="dimmed" fw={600}>{meta.label}</Text>
              </div>
            </Group>
            <SimpleGrid cols={3} spacing="sm">
              {[
                { icon: IconTemperature, label: 'Feels like', value: `${Math.round(cur.apparent_temperature)}°C` },
                { icon: IconDroplet, label: 'Humidity', value: `${cur.relative_humidity_2m}%` },
                { icon: IconWind, label: 'Wind', value: `${Math.round(cur.wind_speed_10m)} km/h` },
              ].map((s) => (
                <Box key={s.label} p="sm" ta="center" style={{ background: '#f6f9f7', borderRadius: 14, border: '1px solid #e9eeeb' }}>
                  <s.icon size={18} color="#1b5a38" />
                  <Text fz={15} fw={800}>{s.value}</Text>
                  <Text fz={11.5} c="dimmed">{s.label}</Text>
                </Box>
              ))}
            </SimpleGrid>

            {/* hourly strip */}
            <div>
              <Text fw={700} fz={13.5} mb={8}>Next hours</Text>
              <Group gap={4} wrap="nowrap" style={{ overflowX: 'auto', paddingBottom: 4 }}>
                {hours.map((h) => {
                  const hm = weatherMeta(h.code);
                  const HIcon = hm.icon;
                  return (
                    <Box key={h.t} p={8} ta="center" miw={54} style={{ background: '#f6f9f7', borderRadius: 12, border: '1px solid #e9eeeb' }}>
                      <Text fz={11} c="dimmed">{dayjs(h.t).format('ha')}</Text>
                      <HIcon size={18} color={hm.color} style={{ margin: '4px 0' }} />
                      <Text fz={12.5} fw={700}>{Math.round(h.temp)}°</Text>
                    </Box>
                  );
                })}
              </Group>
            </div>

            {/* 7-day */}
            <div>
              <Text fw={700} fz={13.5} mb={8}>7-day forecast</Text>
              <Stack gap={4}>
                {data.daily.time.map((d, i) => {
                  const dm = weatherMeta(data.daily.weather_code[i]);
                  const DIcon = dm.icon;
                  return (
                    <Group key={d} justify="space-between" p={8} style={{ background: i === 0 ? '#eef7f1' : '#f9fbfa', borderRadius: 12 }}>
                      <Text fz={13} fw={600} w={80}>{i === 0 ? 'Today' : dayjs(d).format('ddd, MMM D')}</Text>
                      <DIcon size={17} color={dm.color} />
                      <Text fz={12} c="dimmed" w={60} ta="center">{data.daily.precipitation_probability_max[i]}% rain</Text>
                      <Text fz={13} w={90} ta="right">
                        <b>{Math.round(data.daily.temperature_2m_max[i])}°</b>
                        <span style={{ color: '#8a9691' }}> / {Math.round(data.daily.temperature_2m_min[i])}°</span>
                      </Text>
                    </Group>
                  );
                })}
              </Stack>
            </div>

            <Divider />
            <Group justify="space-between">
              <Group gap={12}>
                <Group gap={4}><IconSunrise size={15} color="#f59f00" /><Text fz={12.5}>{dayjs(data.daily.sunrise[0]).format('h:mm a')}</Text></Group>
                <Group gap={4}><IconSunset size={15} color="#e8590c" /><Text fz={12.5}>{dayjs(data.daily.sunset[0]).format('h:mm a')}</Text></Group>
              </Group>
              <Button size="xs" radius="xl" variant="light" leftSection={<IconCurrentLocation size={14} />} onClick={useMyLocation}>
                Use my location
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </>
  );
}
