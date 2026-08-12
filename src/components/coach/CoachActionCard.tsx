'use client'

import type {
  CoachActionRunState,
  CoachActionStatus,
  CoachProposalView,
} from '@/lib/coach'
import CoachActionProgress from './CoachActionProgress'

type Props = {
  proposal: CoachProposalView
  run?: CoachActionRunState | null
  busy?: boolean
  onConfirm: (proposalId: string) => void
  onCancel: (proposalId: string) => void
}

function statusLabel(status: CoachActionStatus): string | null {
  switch (status) {
    case 'pending':
      return null
    case 'confirmed':
      return 'Working…'
    case 'cancelled':
      return 'Cancelled'
    case 'executed':
      return 'Done'
    case 'failed':
      return 'Failed'
    default:
      return null
  }
}

export default function CoachActionCard({
  proposal,
  run,
  busy,
  onConfirm,
  onCancel,
}: Props) {
  const pending = proposal.status === 'pending' && !busy && !run
  const pill = statusLabel(
    run?.phase === 'running'
      ? 'confirmed'
      : run?.phase === 'error'
        ? 'failed'
        : proposal.status,
  )
  const showProgress =
    Boolean(run) &&
    (run!.steps.length > 0 || run!.phase === 'running' || Boolean(run!.message))

  return (
    <div
      className={`coach-action-card coach-action-card--${proposal.kind}${
        pending ? ' coach-action-card--pending' : ''
      }`}
      role="group"
      aria-label={proposal.card.title}
    >
      <div className="coach-action-card__rail" aria-hidden />
      <div className="coach-action-card__body">
        <div className="coach-action-card__header">
          <h3 className="coach-action-card__title">{proposal.card.title}</h3>
          {pill ? (
            <span
              className={`coach-action-card__pill coach-action-card__pill--${
                proposal.status === 'executed' || run?.phase === 'done'
                  ? 'done'
                  : proposal.status === 'failed' || run?.phase === 'error'
                    ? 'error'
                    : proposal.status === 'cancelled'
                      ? 'muted'
                      : 'active'
              }`}
            >
              {pill}
            </span>
          ) : null}
        </div>

        <ul className="coach-action-card__summary">
          {proposal.card.summaryLines.map(line => (
            <li key={line}>{line}</li>
          ))}
        </ul>

        {proposal.card.riskNote ? (
          <p className="coach-action-card__risk">{proposal.card.riskNote}</p>
        ) : null}

        {showProgress && run ? (
          <CoachActionProgress
            steps={run.steps}
            phase={run.phase}
            message={run.message}
          />
        ) : null}

        {pending ? (
          <div className="coach-action-card__actions">
            <button
              type="button"
              className="coach-action-card__btn coach-action-card__btn--cancel press"
              data-haptic="light"
              onClick={() => onCancel(proposal.id)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="coach-action-card__btn coach-action-card__btn--confirm press"
              data-haptic="medium"
              onClick={() => onConfirm(proposal.id)}
            >
              Confirm
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
