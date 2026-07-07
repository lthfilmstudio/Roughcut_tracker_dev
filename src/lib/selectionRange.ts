// Shift+click 範圍選取：回傳 anchor 到 clicked 之間（含兩端）的可見場次 key。
// anchor 不存在或已被 filter 濾掉時，退回只選 clicked 這一筆。
export function rangeKeys(
  visibleKeys: string[],
  anchorKey: string | null,
  clickedKey: string,
): string[] {
  const clickedIdx = visibleKeys.indexOf(clickedKey)
  if (clickedIdx === -1) return [clickedKey]
  const anchorIdx = anchorKey ? visibleKeys.indexOf(anchorKey) : -1
  if (anchorIdx === -1) return [clickedKey]
  const start = Math.min(anchorIdx, clickedIdx)
  const end = Math.max(anchorIdx, clickedIdx)
  return visibleKeys.slice(start, end + 1)
}
