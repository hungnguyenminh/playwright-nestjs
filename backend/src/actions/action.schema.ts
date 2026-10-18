/**
 * JSON Schema for the action DSL (see action.types.ts). Used by the backend to
 * validate scripts with Ajv and served at GET /actions/schema so the frontend
 * editor gets autocompletion and inline errors.
 */
type Schema = Record<string, unknown>;

const str: Schema = { type: 'string' };
/** Numbers may also come from a variable: `"times": "{{count}}"`. */
const varRef: Schema = { type: 'string', pattern: '^\\{\\{[^{}]+\\}\\}$' };
const num: Schema = { anyOf: [{ type: 'number' }, varRef] };
const int: Schema = { anyOf: [{ type: 'integer', minimum: 0 }, varRef] };
const bool: Schema = { type: 'boolean' };
const any: Schema = {};
const strList: Schema = { type: 'array', items: str };
const actions: Schema = { $ref: '#/definitions/actions' };
const condition: Schema = { $ref: '#/definitions/condition' };
const waitUntil: Schema = {
  enum: ['load', 'domcontentloaded', 'networkidle', 'commit'],
};
const varName: Schema = { type: 'string', pattern: '^[A-Za-z_$][\\w$]*$' };
const point: Schema = {
  type: 'object',
  properties: { x: num, y: num },
  required: ['x', 'y'],
};

const extractFields: Schema = {
  type: 'object',
  additionalProperties: {
    anyOf: [
      str,
      {
        type: 'object',
        properties: { selector: str, get: str, multiple: bool },
        additionalProperties: false,
      },
    ],
  },
};

interface Spec {
  description: string;
  props?: Record<string, Schema>;
  required?: string[];
}

export const ACTION_SPECS: Record<string, Spec> = {
  goto: { description: 'Open a URL', props: { url: str, waitUntil }, required: ['url'] },
  back: { description: 'History back', props: { waitUntil } },
  forward: { description: 'History forward', props: { waitUntil } },
  reload: { description: 'Reload the page', props: { waitUntil } },

  click: {
    description: 'Click an element',
    props: {
      selector: str,
      button: { enum: ['left', 'right', 'middle'] },
      modifiers: { type: 'array', items: { enum: ['Alt', 'Control', 'Meta', 'Shift'] } },
      position: point,
      force: bool,
      waitForNavigation: bool,
    },
    required: ['selector'],
  },
  dblclick: {
    description: 'Double-click an element',
    props: { selector: str, button: { enum: ['left', 'right', 'middle'] }, position: point, force: bool },
    required: ['selector'],
  },
  hover: { description: 'Hover an element', props: { selector: str }, required: ['selector'] },
  focus: { description: 'Focus an element', props: { selector: str }, required: ['selector'] },
  fill: { description: 'Set an input value instantly', props: { selector: str, value: str }, required: ['selector', 'value'] },
  clear: { description: 'Clear an input', props: { selector: str }, required: ['selector'] },
  type: {
    description: 'Type text key by key (human-like delay by default)',
    props: { selector: str, text: str, delay: int },
    required: ['text'],
  },
  press: { description: 'Press a key, e.g. Enter, Control+A', props: { selector: str, key: str }, required: ['key'] },
  check: { description: 'Check a checkbox/radio', props: { selector: str }, required: ['selector'] },
  uncheck: { description: 'Uncheck a checkbox', props: { selector: str }, required: ['selector'] },
  select: {
    description: 'Choose <select> option(s) by value or label',
    props: { selector: str, value: { anyOf: [str, strList] } },
    required: ['selector', 'value'],
  },
  upload: { description: 'Set files on an <input type=file>', props: { selector: str, files: strList }, required: ['selector', 'files'] },
  drag: { description: 'Drag one element onto another', props: { source: str, target: str }, required: ['source', 'target'] },
  scroll: {
    description: 'Scroll the page or an element',
    props: { selector: str, to: { enum: ['top', 'bottom'] }, x: num, y: num, untilEnd: bool, maxScrolls: int },
  },
  mouse: { description: 'Move (and optionally click) the mouse at page coordinates', props: { x: num, y: num, click: bool }, required: ['x', 'y'] },

  waitFor: {
    description: 'Wait for a selector, URL, load state or network response',
    props: {
      selector: str,
      state: { enum: ['attached', 'detached', 'visible', 'hidden'] },
      url: str,
      loadState: { enum: ['load', 'domcontentloaded', 'networkidle'] },
      response: str,
    },
  },
  sleep: { description: 'Wait ms (+ random 0..jitter ms)', props: { ms: int, jitter: int }, required: ['ms'] },
  pause: { description: 'Pause until resumed from the UI', props: { message: str } },

  extract: {
    description: 'Extract data into a variable (default "data")',
    props: {
      selector: str,
      fields: extractFields,
      get: str,
      multiple: bool,
      as: varName,
    },
    required: ['selector'],
  },
  screenshot: { description: 'Save a PNG screenshot artifact', props: { selector: str, fullPage: bool, name: str } },
  pdf: { description: 'Save the page as PDF (headless only)', props: { name: str } },
  download: { description: 'Click and save the resulting download', props: { selector: str, name: str, as: varName }, required: ['selector'] },
  getCookies: { description: 'Read cookies into a variable', props: { as: varName, urls: strList } },
  setCookies: { description: 'Add cookies to the context', props: { cookies: { type: 'array', items: { type: 'object' } } }, required: ['cookies'] },
  clearCookies: { description: 'Remove all cookies' },
  evaluate: {
    description: 'Run JS in the page. `script` is a function body or arrow fn; receives `arg`',
    props: { script: str, arg: any, as: varName },
    required: ['script'],
  },
  set: { description: 'Set a variable', props: { var: varName, value: any }, required: ['var', 'value'] },
  log: { description: 'Write a message to the task log', props: { message: str }, required: ['message'] },

  dismissOverlays: { description: 'Close or hide popups / cookie walls covering the page' },
  searchSite: {
    description: 'Find the site search box (or selector), type query and submit. Empty query does nothing',
    props: { query: str, selector: str, as: varName },
    required: ['query'],
  },
  collect: {
    description: 'Extract items like extract multiple, scrolling / pressing "load more" until limit (default 50) distinct items',
    props: {
      selector: str,
      fields: extractFields,
      limit: int,
      maxScrolls: int,
      loadMore: { anyOf: [bool, str] },
      detail: bool,
      extra: { type: 'object' },
      auto: bool,
      hover: str,
      expand: bool,
      required: strList,
      append: bool,
      as: varName,
    },
    required: ['selector'],
  },
  extractAuto: {
    description: 'Detect the main list (products, posts, results) or the article and read title/url/image/price/text without selectors',
    props: {
      mode: { enum: ['auto', 'list', 'article'] },
      limit: int,
      maxScrolls: int,
      detail: bool,
      extra: { type: 'object' },
      append: bool,
      as: varName,
    },
  },

  blockResources: {
    description: 'Abort requests by resource type (image, font, media, stylesheet...)',
    props: { resourceTypes: strList },
    required: ['resourceTypes'],
  },
  intercept: {
    description: 'Abort or mock requests matching a URL glob',
    props: {
      url: str,
      abort: bool,
      fulfill: { type: 'object', properties: { status: int, contentType: str, body: str } },
    },
    required: ['url'],
  },
  captureResponses: {
    description: 'Collect responses whose URL contains `url` into a list variable',
    props: { url: str, as: varName, json: bool },
    required: ['url', 'as'],
  },

  newTab: { description: 'Open and switch to a new tab', props: { url: str } },
  switchTab: { description: 'Switch to tab by index', props: { index: int }, required: ['index'] },
  closeTab: { description: 'Close a tab (default: current)', props: { index: int } },
  frame: { description: 'Run actions inside an iframe', props: { selector: str, actions }, required: ['selector', 'actions'] },
  dialog: { description: 'How to answer the next alert/confirm/prompt dialogs', props: { accept: bool, promptText: str }, required: ['accept'] },

  if: { description: 'Conditional branch', props: { condition, then: actions, else: actions }, required: ['condition', 'then'] },
  repeat: {
    description: 'Loop N times and/or while a condition holds; index in `as` (default $index)',
    props: { times: int, while: condition, maxIterations: int, as: varName, actions },
    required: ['actions'],
  },
  forEach: {
    description: 'Loop over elements (selector) or a list (items); item in `as` (default $item)',
    props: { selector: str, items: any, as: varName, limit: int, actions },
    required: ['actions'],
  },
  try: { description: 'Run actions; on error run `catch` (error in $error)', props: { actions, catch: actions }, required: ['actions'] },
  break: { description: 'Exit the innermost repeat/forEach' },
  stop: { description: 'Finish the task successfully right here', props: { message: str } },
};

const BASE_PROPS: Record<string, Schema> = {
  timeout: int,
  optional: { ...bool, description: 'Ignore errors from this step' },
  label: str,
};

const conditionSchema: Schema = {
  type: 'object',
  minProperties: 1,
  properties: {
    exists: str,
    visible: str,
    urlIncludes: str,
    textIncludes: {
      type: 'object',
      properties: { selector: str, text: str },
      required: ['text'],
    },
    var: str,
    equals: any,
    js: str,
    not: condition,
    all: { type: 'array', items: condition },
    any: { type: 'array', items: condition },
  },
  additionalProperties: false,
};

export function buildActionSchema(): Schema {
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: 'browser-automation/actions',
    definitions: {
      condition: conditionSchema,
      action: {
        type: 'object',
        required: ['type'],
        discriminator: { propertyName: 'type' },
        oneOf: Object.entries(ACTION_SPECS).map(([type, spec]) => ({
          description: spec.description,
          properties: {
            type: { const: type, description: spec.description },
            ...BASE_PROPS,
            ...spec.props,
          },
          required: ['type', ...(spec.required ?? [])],
          additionalProperties: false,
        })),
      },
      actions: { type: 'array', items: { $ref: '#/definitions/action' } },
    },
    $ref: '#/definitions/actions',
  };
}
