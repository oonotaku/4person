import { notFound } from 'next/navigation'
import Head from 'next/head'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import DiscussionSummary from '@/components/DiscussionSummary'
import type { Discussion } from '@/types/discussion'

interface Props {
  params: Promise<{ id: string }>
}

export default async function DiscussionPage({ params }: Props) {
  const { id } = await params

  const { data, error } = await supabase
    .from('discussions')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !data) {
    notFound()
  }

  const discussion = data as Discussion
  const isCompleted = discussion.status === 'completed'

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="max-w-2xl mx-auto">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-blue-700 hover:underline mb-6"
        >
          ← トップに戻る
        </Link>

        {isCompleted && discussion.summary ? (
          <>
            <div className="mb-4 flex items-center gap-2 rounded-xl bg-gray-100 border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-500">
              <span aria-hidden="true">🔒</span>
              この議論は終了しました
            </div>
            <DiscussionSummary summary={discussion.summary} />
          </>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <div className="text-4xl mb-3">💬</div>
            <p className="text-sm">この議論はまだ進行中です</p>
          </div>
        )}
      </div>
    </div>
  )
}
