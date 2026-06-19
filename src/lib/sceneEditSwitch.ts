interface ActiveSceneEdit<T> {
  rowIndex: number
  draft: T
}

export async function saveBeforeSceneSwitch<T>(
  current: ActiveSceneEdit<T> | null,
  nextRowIndex: number,
  save: (rowIndex: number, draft: T) => Promise<boolean>,
): Promise<boolean> {
  if (!current || current.rowIndex === nextRowIndex) return true
  return save(current.rowIndex, current.draft)
}
