/**
 * Maps browser KeyboardEvent.code -> Android KeyEvent.KEYCODE_* and modifier metaState.
 */
export const CODE_TO_ANDROID_KEYCODE = {
  // Letters
  KeyA: 29, KeyB: 30, KeyC: 31, KeyD: 32, KeyE: 33, KeyF: 34, KeyG: 35,
  KeyH: 36, KeyI: 37, KeyJ: 38, KeyK: 39, KeyL: 40, KeyM: 41, KeyN: 42,
  KeyO: 43, KeyP: 44, KeyQ: 45, KeyR: 46, KeyS: 47, KeyT: 48, KeyU: 49,
  KeyV: 50, KeyW: 51, KeyX: 52, KeyY: 53, KeyZ: 54,

  // Digits
  Digit0: 7, Digit1: 8, Digit2: 9, Digit3: 10, Digit4: 11,
  Digit5: 12, Digit6: 13, Digit7: 14, Digit8: 15, Digit9: 16,

  // Navigation & Editing
  Enter: 66,
  NumpadEnter: 160,
  Escape: 111,
  Backspace: 67,
  Tab: 61,
  Space: 62,
  Delete: 112,
  Insert: 124,
  Home: 122,
  End: 123,
  PageUp: 92,
  PageDown: 93,
  ArrowUp: 19,
  ArrowDown: 20,
  ArrowLeft: 21,
  ArrowRight: 22,

  // Punctuation
  Minus: 69,
  Equal: 70,
  BracketLeft: 71,
  BracketRight: 72,
  Backslash: 73,
  Semicolon: 74,
  Quote: 75,
  Backquote: 68,
  Comma: 55,
  Period: 56,
  Slash: 76,

  // Modifiers
  ShiftLeft: 59,
  ShiftRight: 60,
  ControlLeft: 113,
  ControlRight: 114,
  AltLeft: 57,
  AltRight: 58,
  MetaLeft: 117,
  MetaRight: 118,
  CapsLock: 115,

  // Function keys
  F1: 131, F2: 132, F3: 133, F4: 134, F5: 135, F6: 136,
  F7: 137, F8: 138, F9: 139, F10: 140, F11: 141, F12: 142,
};

export const ANDROID_META = {
  SHIFT_ON: 0x01,
  ALT_ON: 0x02,
  CTRL_ON: 0x1000,
  META_ON: 0x10000,
};

export function getAndroidMetaState(e) {
  let meta = 0;
  if (e.shiftKey) meta |= ANDROID_META.SHIFT_ON;
  if (e.altKey) meta |= ANDROID_META.ALT_ON;
  if (e.ctrlKey) meta |= ANDROID_META.CTRL_ON;
  if (e.metaKey) meta |= ANDROID_META.META_ON;
  return meta;
}
