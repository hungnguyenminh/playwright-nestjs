<script setup lang="ts">
import type { Frame } from '~/types/api';

/**
 * Live view of a running task's current tab (CDP screencast relayed over
 * Socket.IO). Frames only flow while this component is mounted. With
 * `interactive`, mouse and keyboard on the image are replayed on the page
 * (the backend accepts input only while the task is paused).
 */
const props = withDefaults(
  defineProps<{ taskId: string; quality?: 'low' | 'high'; active?: boolean; interactive?: boolean }>(),
  { quality: 'low', active: true, interactive: false },
);
const emit = defineEmits<{ inputError: [string] }>();

const src = ref<string>();
/** Page viewport in CSS pixels: the coordinate space input is sent in. */
const viewport = ref({ width: 0, height: 0 });
const img = ref<HTMLImageElement>();
const focused = ref(false);

useLiveRoom('subscribe:task', () =>
  props.active ? { taskId: props.taskId, quality: props.quality } : null,
);
useLiveEvent<Frame>('task:frame', (f) => {
  if (f.taskId !== props.taskId) return;
  src.value = `data:image/jpeg;base64,${f.data}`;
  if (f.width && f.height) viewport.value = { width: f.width, height: f.height };
});

watch(
  () => props.taskId,
  () => (src.value = undefined),
);

// ---- takeover -------------------------------------------------------------

const socket = useSocket();
const BUTTONS = ['left', 'middle', 'right'] as const;
const MODIFIERS = ['Shift', 'Control', 'Alt', 'Meta'];
const held = new Set<string>();
/** Button held on the remote page and where, to release it if the pointer leaves. */
let pressed: { button: string; x: number; y: number } | undefined;

function send(event: Record<string, unknown>) {
  socket.emit('input', { taskId: props.taskId, ...event }, (res: { ok: boolean; error?: string }) => {
    if (!res?.ok) emit('inputError', res?.error ?? 'Input failed');
  });
}

/** Mouse position → page coordinates, accounting for object-contain letterboxing. */
function toPage(ev: MouseEvent) {
  const el = img.value;
  if (!el?.naturalWidth || !viewport.value.width) return null;
  const rect = el.getBoundingClientRect();
  const scale = Math.min(rect.width / el.naturalWidth, rect.height / el.naturalHeight);
  const w = el.naturalWidth * scale;
  const h = el.naturalHeight * scale;
  const fx = (ev.clientX - rect.left - (rect.width - w) / 2) / w;
  const fy = (ev.clientY - rect.top - (rect.height - h) / 2) / h;
  if (fx < 0 || fy < 0 || fx > 1 || fy > 1) return null;
  return {
    x: Math.round(fx * viewport.value.width),
    y: Math.round(fy * viewport.value.height),
  };
}

function onMouse(action: 'down' | 'up', ev: MouseEvent) {
  if (!props.interactive) return;
  const p = toPage(ev);
  if (!p) return;
  ev.preventDefault();
  if (action === 'down') (ev.currentTarget as HTMLElement).parentElement?.focus();
  pressed = action === 'down' ? { button: BUTTONS[ev.button] ?? 'left', ...p } : undefined;
  send({ kind: 'mouse', action, ...p, button: BUTTONS[ev.button] ?? 'left', clickCount: ev.detail || 1 });
}

function onLeave() {
  if (!pressed) return;
  send({ kind: 'mouse', action: 'up', ...pressed });
  pressed = undefined;
}

let lastMove = 0;
function onMove(ev: MouseEvent) {
  if (!props.interactive) return;
  const now = performance.now();
  if (now - lastMove < 50) return;
  lastMove = now;
  const p = toPage(ev);
  if (p) send({ kind: 'mouse', action: 'move', ...p });
}

function onWheel(ev: WheelEvent) {
  if (!props.interactive) return;
  const p = toPage(ev);
  if (!p) return;
  ev.preventDefault();
  const unit = ev.deltaMode === 1 ? 40 : ev.deltaMode === 2 ? viewport.value.height : 1;
  send({ kind: 'wheel', ...p, dx: ev.deltaX * unit, dy: ev.deltaY * unit });
}

function onKey(action: 'down' | 'up', ev: KeyboardEvent) {
  if (!props.interactive || ev.isComposing || ev.key === 'Process') return;
  // Ctrl/Cmd+V pastes *your* clipboard (see onPaste), not the remote one.
  if (action === 'down' && (ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'v') return;
  ev.preventDefault();
  if (action === 'down') held.add(ev.key);
  else held.delete(ev.key);
  send({ kind: 'key', action, key: ev.key });
}

function onPaste(ev: ClipboardEvent) {
  if (!props.interactive) return;
  const text = ev.clipboardData?.getData('text');
  ev.preventDefault();
  if (text) send({ kind: 'text', text });
}

function onComposition(ev: CompositionEvent) {
  if (props.interactive && ev.data) send({ kind: 'text', text: ev.data });
}

/** Don't leave Shift/Ctrl stuck on the remote page when focus moves away. */
function onBlur() {
  focused.value = false;
  for (const key of held) if (MODIFIERS.includes(key)) send({ kind: 'key', action: 'up', key });
  held.clear();
}
</script>

<template>
  <div
    class="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded bg-gray-900 outline-none"
    :class="props.interactive ? (focused ? 'ring-2 ring-amber-500' : 'ring-1 ring-amber-300') : ''"
    :tabindex="props.interactive ? 0 : undefined"
    @focus="focused = true"
    @blur="onBlur"
    @keydown="onKey('down', $event)"
    @keyup="onKey('up', $event)"
    @paste="onPaste"
    @compositionend="onComposition"
  >
    <img
      v-if="src"
      ref="img"
      :src="src"
      class="h-full w-full select-none object-contain"
      :class="props.interactive ? 'cursor-default' : ''"
      alt="live"
      draggable="false"
      @mousedown="onMouse('down', $event)"
      @mouseup="onMouse('up', $event)"
      @mousemove="onMove"
      @mouseleave="onLeave"
      @wheel="onWheel"
      @contextmenu="props.interactive && $event.preventDefault()"
    />
    <span v-else class="text-xs text-gray-400">{{ props.active ? 'Waiting for frames…' : 'Not running' }}</span>
    <span
      v-if="src && props.active"
      class="absolute right-2 top-2 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white"
      :class="props.interactive ? 'bg-amber-600' : 'bg-red-600'"
    >
      {{ props.interactive ? 'control' : 'live' }}
    </span>
    <span
      v-if="props.interactive && src"
      class="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded bg-black/60 px-2 py-0.5 text-[11px] text-white"
    >
      {{ focused ? 'Keyboard captured — click outside to release' : 'Click the page to control it' }}
    </span>
  </div>
</template>
