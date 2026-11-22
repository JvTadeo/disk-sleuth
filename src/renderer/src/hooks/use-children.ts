import { useEffect, useState } from 'react'
import type { ChildrenResult, NodeInfo, TreemapNode } from '@shared/scan'

/**
 * Runs a query against the scan tree and keeps the latest result.
 * `key` changes whenever the tree changes, so results from an older tree are never shown.
 */
function useScanQuery<T>(
  nodeId: number | null,
  key: string | undefined,
  fetcher: (id: number) => Promise<T | null>
): { data: T | null; loading: boolean } {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (nodeId === null || key === undefined) {
      setData(null)
      return
    }
    let stale = false
    setLoading(true)
    fetcher(nodeId)
      .then((r) => {
        if (!stale) setData(r)
      })
      .finally(() => {
        if (!stale) setLoading(false)
      })
    return () => {
      stale = true
    }
    // The fetcher is a stable module-level function.
  }, [nodeId, key])

  return { data, loading }
}

const fetchChildren = (id: number): Promise<ChildrenResult | null> => window.api.scan.children(id)
const fetchTreemap = (id: number): Promise<TreemapNode | null> => window.api.scan.treemap(id)
const fetchInfo = (id: number): Promise<NodeInfo | null> => window.api.scan.info(id)

export const useChildren = (nodeId: number | null, key: string | undefined) => useScanQuery(nodeId, key, fetchChildren)
export const useTreemap = (nodeId: number | null, key: string | undefined) => useScanQuery(nodeId, key, fetchTreemap)
export const useNodeInfo = (nodeId: number | null, key: string | undefined) => useScanQuery(nodeId, key, fetchInfo)
