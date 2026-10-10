const MAX_MOMENT_KEY_LENGTH = 100;
const GENERIC_MOMENT_KEYS = new Set(["new", "temp", "thing", "foo"]);

export function isGenericMomentKey(value: string): boolean {
  const key = value.trim().toLowerCase();
  return /^(?:moment|new_moment|new)_[0-9]+$/.test(key) || GENERIC_MOMENT_KEYS.has(key);
}

export function isMeaningfulMomentKey(value: string): boolean {
  const key = value.trim();
  return (
    key.length > 0 &&
    key.length <= MAX_MOMENT_KEY_LENGTH &&
    /^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(key) &&
    !isGenericMomentKey(key)
  );
}
