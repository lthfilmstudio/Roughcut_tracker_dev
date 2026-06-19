export const EP_COL_DEFS: { key: string; label: string }[] = [
  { key: 'sceneNum', label: '場次' },
  { key: 'roughcutLength', label: '長度' },
  { key: 'pages', label: '頁數' },
  { key: 'date', label: '日期' },
  { key: 'status', label: '狀態' },
  { key: 'missingShots', label: '缺鏡' },
  { key: 'outline', label: '大綱' },
  { key: 'notes', label: '備註' },
]

export const EP_PDF_FIELDS: { key: string; label: string }[] = [
  { key: 'summary', label: '統計摘要' },
  ...EP_COL_DEFS,
]

export const EP_PDF_DEFAULTS: Record<string, boolean> = Object.fromEntries(
  EP_PDF_FIELDS.map(field => [field.key, true]),
)
