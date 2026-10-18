import type { Config } from 'tailwindcss';

export default {
  content: ['./components/**/*.vue', './layouts/**/*.vue', './pages/**/*.vue', './app.vue'],
  // Tailwind's CSS reset breaks Element Plus buttons/inputs; Element Plus ships its own base styles.
  corePlugins: { preflight: false },
} satisfies Config;
