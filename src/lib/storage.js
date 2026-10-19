// Локальное хранение в браузере. На GitHub Pages все сайты пользователя делят
// один origin (<user>.github.io), поэтому только собственный ключ с префиксом.
export const STORAGE_KEY = "rosdistant-title-page:v1";
const SCHEMA = 1;

function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadState() {
  try {
    const raw = storage()?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const state = JSON.parse(raw);
    return state && state.schema === SCHEMA ? state : null;
  } catch {
    return null;
  }
}

/** @returns {boolean} удалось ли сохранить */
export function saveState(state) {
  try {
    const s = storage();
    if (!s) return false;
    s.setItem(STORAGE_KEY, JSON.stringify({ ...state, schema: SCHEMA }));
    return true;
  } catch {
    return false;
  }
}

export function clearState() {
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    // нечего удалять
  }
}
