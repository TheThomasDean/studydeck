import { useCallback, useEffect, useRef, useState } from 'react'
import { isSupportedFile } from '@lib/importParse'
import { useStore } from './store'
import type { Navigate, Route } from './routes'
import { TopBar } from './components/TopBar'
import { Library } from './components/Library'
import { SetPage } from './components/SetPage'
import { Editor } from './components/Editor'
import { ImportWizard } from './components/ImportWizard'
import { StudyRouter } from './modes/StudyRouter'
import { Splash } from './components/Credits'

export default function App() {
  const { ready, loadError, toast, notify } = useStore()
  const [route, setRoute] = useState<Route>({ name: 'library' })
  const [dragging, setDragging] = useState(false)
  const [splash, setSplash] = useState(true)
  const hideSplash = useCallback(() => setSplash(false), [])
  const dragDepth = useRef(0)
  const mainRef = useRef<HTMLElement>(null)

  const navigate: Navigate = useCallback((r) => {
    setRoute(r)
    // Move focus to the new screen for keyboard and screen-reader users.
    requestAnimationFrame(() => mainRef.current?.focus({ preventScroll: true }))
    window.scrollTo(0, 0)
  }, [])

  // Drag-and-drop a spreadsheet anywhere on the window to import it.
  // The import wizard handles drops itself while it is open.
  useEffect(() => {
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      dragDepth.current++
      setDragging(true)
    }
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (dragDepth.current === 0) setDragging(false)
    }
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return // internal drags (e.g. reordering cards) manage themselves
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    const onDrop = async (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      dragDepth.current = 0
      setDragging(false)
      const file = e.dataTransfer?.files?.[0]
      if (!file) return
      if (!isSupportedFile(file.name)) {
        notify(`"${file.name}" is not a spreadsheet. Drop an .xlsx, .xls, .csv or .tsv file.`, 'error')
        return
      }
      try {
        const data = new Uint8Array(await file.arrayBuffer())
        navigate({ name: 'import', file: { name: file.name, data } })
      } catch (err) {
        notify(`Could not read "${file.name}": ${String(err)}`, 'error')
      }
    }
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('dragover', onOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [navigate, notify])

  let screen: React.ReactNode
  if (!ready) screen = <div className="center-msg">Loading your study sets…</div>
  else if (loadError)
    screen = (
      <div className="center-msg error-box" role="alert">
        <h2>Could not load your data</h2>
        <p>{loadError}</p>
      </div>
    )
  else {
    switch (route.name) {
      case 'library':
        screen = <Library navigate={navigate} />
        break
      case 'set':
        screen = <SetPage setId={route.setId} navigate={navigate} />
        break
      case 'edit':
        screen = <Editor key={route.setId} setId={route.setId} navigate={navigate} />
        break
      case 'import':
        screen = <ImportWizard key={route.file?.name ?? 'import'} initialFile={route.file} navigate={navigate} />
        break
      case 'study':
        screen = <StudyRouter key={`${route.setId}:${route.mode}:${route.cardIds?.join(',') ?? ''}`} route={route} navigate={navigate} />
        break
    }
  }

  return (
    <div className="app">
      {splash && <Splash onDone={hideSplash} />}
      <TopBar navigate={navigate} />
      <main ref={mainRef} tabIndex={-1} className="main">
        {screen}
      </main>
      {dragging && route.name !== 'import' && (
        <div className="drop-overlay" aria-hidden="true">
          <div className="drop-overlay-inner">Drop a spreadsheet to import it</div>
        </div>
      )}
      <div className="toast-region" role="status" aria-live="polite">
        {toast && (
          <div key={toast.id} className={`toast ${toast.kind === 'error' ? 'toast-error' : ''}`}>
            {toast.message}
          </div>
        )}
      </div>
    </div>
  )
}
