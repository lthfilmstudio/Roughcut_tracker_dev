import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import SceneTable from '../src/components/SceneTable'
import type { SceneRow } from '../src/types'
import '../src/index.css'

// Only in-memory fixtures: never imports a data service or contacts the backend.
const fixture: SceneRow[] = [{
  scene: 'TEST-1', roughcutLength: '00:01:00', pages: '0.3',
  roughcutDate: '2026/09/14', status: '已精剪', missingShots: '',
  outline: '儲存回歸測試假資料', notes: '',
}, {
  scene: 'TEST-2', roughcutLength: '00:02:00', pages: '1',
  roughcutDate: '2026/09/14', status: '已初剪', missingShots: '',
  outline: '第二場切換測試假資料', notes: '',
}]

function Harness() {
  const [scenes, setScenes] = useState(fixture)
  const [saving, setSaving] = useState(false)
  const [calls, setCalls] = useState(0)
  const [fail, setFail] = useState(false)
  const [error, setError] = useState('')
  const [episode, setEpisode] = useState('ep07')
  const noop = async () => {}
  async function update(rowIndex: number, draft: SceneRow) {
    setSaving(true)
    setCalls(n => n + 1)
    setError('')
    try {
      await new Promise(resolve => setTimeout(resolve, 350))
      if (fail) throw new Error('測試用儲存失敗')
      setScenes(rows => rows.map((row, i) => i === rowIndex ? { ...draft } : row))
    } catch (err) {
      setError((err as Error).message)
      throw err
    } finally { setSaving(false) }
  }
  return <main style={{ padding: 24 }}>
    <h1>SceneTable 儲存回歸測試（假資料）</h1>
    <p>每次儲存延遲 350 ms。直接按儲存、輸入後按儲存、Enter 都應完成並關閉編輯列；失敗時應保留草稿。</p>
    <label>測試集數 <select value={episode} onChange={e => setEpisode(e.target.value)}><option>ep07</option><option>ep08</option></select></label>
    <label><input type="checkbox" checked={fail} onChange={e => setFail(e.target.checked)} />模擬失敗</label>
    <output style={{ display: 'block' }}>寫入次數：{calls}；狀態：{saving ? '儲存中' : '閒置'}；{error}</output>
    <pre data-testid="saved-scenes">{JSON.stringify(scenes)}</pre>
    <SceneTable resetKey={episode} scenes={scenes} saving={saving}
      onUpdateScene={update} onAppendScene={noop} onDeleteScene={noop}
      onBatchUpdate={noop} onBatchDeleteScenes={noop}
      onOpenBatchImport={noop} onOpenExportMD={noop} onOpenExportCSV={noop} onOpenExportPDF={noop} />
  </main>
}

createRoot(document.getElementById('root')!).render(<Harness />)
