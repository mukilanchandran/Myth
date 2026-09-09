import { createTheme, rem } from '@mantine/core';

export const theme = createTheme({
  fontFamily: "'Figtree', -apple-system, sans-serif",
  headings: {
    fontFamily: "'Figtree', -apple-system, sans-serif",
    fontWeight: '700',
  },
  primaryColor: 'forest',
  primaryShade: 6,
  colors: {
    forest: [
      '#e6efea', '#c9dbd1', '#a3bfb0', '#7ba38e', '#54876c',
      '#2f6a4d', '#0D2D1C', '#0a2416', '#071b10', '#04120a',
    ],
  },
  defaultRadius: 'lg',
  radius: { lg: rem(16), xl: rem(24) },
  components: {
    Button: { defaultProps: { radius: 'xl' } },
    TextInput: { defaultProps: { radius: 'xl' } },
    PasswordInput: { defaultProps: { radius: 'xl' } },
    Select: { defaultProps: { radius: 'lg' } },
    Badge: { defaultProps: { radius: 'sm' } },
    Modal: { defaultProps: { radius: 'xl', overlayProps: { blur: 6, opacity: 0.3 } } },
    Drawer: { defaultProps: { overlayProps: { blur: 6, opacity: 0.3 } } },
  },
});
