import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router'
import { Navigate } from 'react-router'
import { FlowHeader } from '../components/ui-bits'
import Markdown from '../components/Markdown'
import { formatUpdated, getPolicy, POLICIES, type LegalDoc } from '../legal/policies'
import { track } from '../lib/analytics'

const DOC_LABELS: Record<LegalDoc, string> = {
  privacy: 'Privacy',
  terms: 'Terms',
  refund: 'Refunds',
}

export default function Legal() {
  const { doc } = useParams()
  const navigate = useNavigate()
  const policy = getPolicy(doc)

  useEffect(() => {
    if (policy) track('legal_page_viewed', { doc: policy.doc })
  }, [policy])

  if (!policy) return <Navigate to="/help" replace />

  return (
    <div className="flex min-h-dvh flex-col bg-[#0A0A0A]">
      <FlowHeader title={policy.title} onBack={() => navigate(-1)} />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-16 pt-4">
        <p className="mb-6 text-xs font-medium uppercase tracking-wide text-[#9A9A9E]">
          Last updated {formatUpdated(policy.updated)}
        </p>
        <Markdown text={policy.markdown} />

        <div className="mt-10 flex flex-col gap-2 rounded-[14px] bg-[#1C1C1E] p-4">
          <p className="text-xs text-[#9A9A9E]">
            Questions about this policy? Contact us.
          </p>
          <div className="flex gap-4">
            {(Object.keys(POLICIES) as LegalDoc[])
              .filter((d) => d !== policy.doc)
              .map((d) => (
                <button
                  key={d}
                  onClick={() => navigate(`/legal/${d}`)}
                  className="text-xs font-semibold text-[#D7FF3F]"
                >
                  {DOC_LABELS[d]}
                </button>
              ))}
          </div>
        </div>
      </main>
    </div>
  )
}
