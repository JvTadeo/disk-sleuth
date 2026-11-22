import { lazy, Suspense, useEffect, useRef } from 'react'
import { TitleBar } from '@/components/layout/TitleBar'
import { Sidebar } from '@/components/layout/Sidebar'
import Overview from '@/pages/Overview'
import { useApp } from '@/store/app'

// The first page ships in the main bundle; the others load only when opened.
const Disk = lazy(() => import('@/pages/Disk'))
const Programs = lazy(() => import('@/pages/Programs'))
const Settings = lazy(() => import('@/pages/Settings'))
const Scan = lazy(() => import('@/pages/Scan'))

function CurrentPage() {
  const page = useApp((s) => s.page)
  switch (page) {
    case 'disk':
      return <Disk />
    case 'programs':
      return <Programs />
    case 'settings':
      return <Settings />
    case 'scan':
      return <Scan />
    default:
      return <Overview />
  }
}

export default function App() {
  const page = useApp((s) => s.page)
  const mainRef = useRef<HTMLElement>(null)
  // Each page starts at the top.
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 })
  }, [page])
  const syncTheme = useApp((s) => s.syncTheme)
  const loadDrives = useApp((s) => s.loadDrives)
  const initScan = useApp((s) => s.initScan)
  const loadAppInfo = useApp((s) => s.loadAppInfo)

  useEffect(() => {
    void window.api.theme.get().then(syncTheme)
    const offTheme = window.api.theme.onChange(syncTheme)
    const offScan = initScan()
    void loadDrives()
    void loadAppInfo()
    // Notify the main process after the first painted frame (measures startup time).
    requestAnimationFrame(() => window.api.app.ready())
    return () => {
      offTheme()
      offScan()
    }
  }, [syncTheme, loadDrives, initScan, loadAppInfo])

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main ref={mainRef} className="flex min-w-0 flex-1 flex-col overflow-y-auto px-7 py-6">
          <Suspense fallback={null}>
            {/* A new key per page replays the enter animation. */}
            <div key={page} className="page-enter flex min-h-0 flex-1 flex-col gap-5">
              <CurrentPage />
            </div>
          </Suspense>
        </main>
      </div>
    </div>
  )
}
