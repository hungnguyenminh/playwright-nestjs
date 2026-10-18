/**
 * Shared, reactive screen size (SPA only): phone < 768px, tablet < 1280px.
 * Matches Tailwind's md / xl breakpoints used in the templates.
 */
const width = ref(typeof window === 'undefined' ? 1440 : window.innerWidth);
let listening = false;

export function useBreakpoint() {
  if (!listening && typeof window !== 'undefined') {
    listening = true;
    window.addEventListener('resize', () => (width.value = window.innerWidth), { passive: true });
  }
  const isPhone = computed(() => width.value < 768);
  const isTablet = computed(() => width.value >= 768 && width.value < 1280);
  return { width, isPhone, isTablet, isDesktop: computed(() => width.value >= 1280) };
}
