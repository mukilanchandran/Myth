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
      '#e8f8ee', '#d3eedd', '#a8dcbc', '#7aca99', '#54bb7c',
      '#3cb26a', '#12a150', '#238a52', '#177a45', '#036a37',
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
