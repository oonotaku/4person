"use client"

import { useState, useEffect, useCallback } from "react"
import { supabase } from "@/lib/supabase"
import type { Discussion } from "@/types/discussion"

interface UseDiscussionResult {
  discussion: Discussion | null
  isLoading: boolean
  error: Error | null
  refetch: () => Promise<void>
}

/**
 * 指定セッションの議論データを取得し、ステータス変更をリアルタイムで監視するフック。
 *
 * @param sessionId - 監視対象のセッション ID（null の場合は何もしない）
 */
export function useDiscussion(sessionId: string | null): UseDiscussionResult {
  const [discussion, setDiscussion] = useState<Discussion | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const fetchDiscussion = useCallback(async () => {
    if (!sessionId) {
      setDiscussion(null)
      return
    }
    setIsLoading(true)
    setError(null)
    try {
      const { data, error: fetchError } = await supabase
        .from("discussions")
        .select("*")
        .eq("id", sessionId)
        .single()
      if (fetchError) throw fetchError
      setDiscussion(data as Discussion)
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)))
    } finally {
      setIsLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    if (!sessionId) {
      setDiscussion(null)
      setError(null)
      return
    }

    // 初回データ取得
    fetchDiscussion()

    // discussions テーブルの INSERT / UPDATE をリアルタイム監視
    const channel = supabase
      .channel(`discussion:${sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "discussions",
          filter: `id=eq.${sessionId}`,
        },
        (payload) => {
          setDiscussion(payload.new as Discussion)
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "discussions",
          filter: `id=eq.${sessionId}`,
        },
        (payload) => {
          setDiscussion(payload.new as Discussion)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [sessionId, fetchDiscussion])

  return { discussion, isLoading, error, refetch: fetchDiscussion }
}
