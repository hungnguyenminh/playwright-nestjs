/**
 * Automation script DSL. A script is an ordered list of actions; string fields
 * may reference variables with `{{name}}` / `{{obj.path}}` (see interpolate.ts).
 * Every action accepts an optional `timeout` (ms) and `optional: true` to
 * swallow its error and continue.
 */
interface Base {
  timeout?: number;
  optional?: boolean;
  /** Free-text label shown in logs. */
  label?: string;
}

type WaitUntil = 'load' | 'domcontentloaded' | 'networkidle' | 'commit';

export type Condition =
  | { exists: string }
  | { visible: string }
  | { urlIncludes: string }
  | { textIncludes: { selector?: string; text: string } }
  | { var: string; equals?: unknown }
  | { js: string }
  | { not: Condition }
  | { all: Condition[] }
  | { any: Condition[] };

export interface ExtractField {
  selector?: string;
  /** `text` (default), `html`, `value`, or `attr:<name>` e.g. `attr:href`. */
  get?: string;
  multiple?: boolean;
}

export type Action = Base &
  (
    // navigation
    | { type: 'goto'; url: string; waitUntil?: WaitUntil }
    | { type: 'back' | 'forward' | 'reload'; waitUntil?: WaitUntil }
    // interaction
    | {
        type: 'click' | 'dblclick';
        selector: string;
        button?: 'left' | 'right' | 'middle';
        modifiers?: Array<'Alt' | 'Control' | 'Meta' | 'Shift'>;
        position?: { x: number; y: number };
        force?: boolean;
        /** Wait for a navigation started by the click. */
        waitForNavigation?: boolean;
      }
    | { type: 'hover'; selector: string }
    | { type: 'focus'; selector: string }
    | { type: 'fill'; selector: string; value: string }
    | { type: 'clear'; selector: string }
    | {
        type: 'type';
        selector?: string;
        text: string;
        /** ms between keys; default 50–150 random for a human-like rhythm. */
        delay?: number;
      }
    | { type: 'press'; selector?: string; key: string }
    | { type: 'check' | 'uncheck'; selector: string }
    | { type: 'select'; selector: string; value: string | string[] }
    | { type: 'upload'; selector: string; files: string[] }
    | { type: 'drag'; source: string; target: string }
    | {
        type: 'scroll';
        selector?: string;
        to?: 'top' | 'bottom';
        x?: number;
        y?: number;
        /** Scroll to bottom repeatedly until no new content (infinite feeds). */
        untilEnd?: boolean;
        maxScrolls?: number;
      }
    | { type: 'mouse'; x: number; y: number; click?: boolean }
    // waiting
    | {
        type: 'waitFor';
        selector?: string;
        state?: 'attached' | 'detached' | 'visible' | 'hidden';
        url?: string;
        loadState?: 'load' | 'domcontentloaded' | 'networkidle';
        /** Substring or /regex/ of a response URL to wait for. */
        response?: string;
      }
    | { type: 'sleep'; ms: number; jitter?: number }
    /** Block until resumed from the UI (e.g. solve a captcha by hand). */
    | { type: 'pause'; message?: string }
    // data
    | {
        type: 'extract';
        selector: string;
        fields?: Record<string, string | ExtractField>;
        get?: string;
        multiple?: boolean;
        as?: string;
      }
    | { type: 'screenshot'; selector?: string; fullPage?: boolean; name?: string }
    | { type: 'pdf'; name?: string }
    | { type: 'download'; selector: string; name?: string; as?: string }
    | { type: 'getCookies'; as?: string; urls?: string[] }
    | { type: 'setCookies'; cookies: Array<Record<string, unknown>> }
    | { type: 'clearCookies' }
    | { type: 'evaluate'; script: string; arg?: unknown; as?: string }
    | { type: 'set'; var: string; value: unknown }
    | { type: 'log'; message: string }
    // sources: work on pages without hand-written selectors
    /** Close or hide popups, promo modals and cookie walls covering the page. */
    | { type: 'dismissOverlays' }
    /** Find the site search box, type `query` and submit; empty query = do nothing. */
    | { type: 'searchSite'; query: string; selector?: string; as?: string }
    /** Like extract multiple, but scrolls / presses "load more" until `limit` distinct items. */
    | {
        type: 'collect';
        selector: string;
        fields?: Record<string, string | ExtractField>;
        limit?: number;
        maxScrolls?: number;
        /** true (default) = look for a "Xem thêm" button; a selector; false = only scroll. */
        loadMore?: boolean | string;
        /** Open each item's url and add its description / content / date. */
        detail?: boolean;
        /** Fields added to every item (source, keyword…). */
        extra?: Record<string, unknown>;
        /** Also read title / url / image / price / text automatically; `fields` override them. */
        auto?: boolean;
        /** Fire hover events on these elements inside each item before reading (links set on hover). */
        hover?: string;
        /** Click "Xem thêm / See more" inside items to read the full text. */
        expand?: boolean;
        /** Skip items where any of these fields is empty. */
        required?: string[];
        /** Add to the list already in `as` (e.g. several result pages) instead of replacing it. */
        append?: boolean;
        as?: string;
      }
    /** Detect the main list (or the article) on the page and read it without selectors. */
    | {
        type: 'extractAuto';
        mode?: 'auto' | 'list' | 'article';
        limit?: number;
        maxScrolls?: number;
        detail?: boolean;
        extra?: Record<string, unknown>;
        append?: boolean;
        as?: string;
      }
    // network
    | { type: 'blockResources'; resourceTypes: string[] }
    | {
        type: 'intercept';
        url: string;
        abort?: boolean;
        fulfill?: { status?: number; contentType?: string; body?: string };
      }
    | { type: 'captureResponses'; url: string; as: string; json?: boolean }
    // tabs & frames
    | { type: 'newTab'; url?: string }
    | { type: 'switchTab'; index: number }
    | { type: 'closeTab'; index?: number }
    | { type: 'frame'; selector: string; actions: Action[] }
    | { type: 'dialog'; accept: boolean; promptText?: string }
    // control flow
    | { type: 'if'; condition: Condition; then: Action[]; else?: Action[] }
    | {
        type: 'repeat';
        times?: number;
        while?: Condition;
        maxIterations?: number;
        as?: string;
        actions: Action[];
      }
    | {
        type: 'forEach';
        /** Iterate elements; nested selectors are scoped to the element, use `:scope` for itself. */
        selector?: string;
        /** Iterate a list: a literal array or a `{{var}}` reference. */
        items?: unknown;
        as?: string;
        limit?: number;
        actions: Action[];
      }
    | { type: 'try'; actions: Action[]; catch?: Action[] }
    | { type: 'break' }
    | { type: 'stop'; message?: string }
  );

export type ActionType = Action['type'];

/**
 * Keys interpolated lazily: nested action lists (interpolated per step when
 * they run) and conditions (re-evaluated on every loop iteration).
 */
export const LAZY_KEYS = new Set([
  'actions',
  'then',
  'else',
  'catch',
  'condition',
  'while',
]);

type Narrow<A, T> = A extends { type: infer U }
  ? T extends U
    ? A & { type: T }
    : never
  : never;

/** The action variant for one type; also works for shared variants like `click | dblclick`. */
export type ActionOf<T extends ActionType> = Narrow<Action, T>;
