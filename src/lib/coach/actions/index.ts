export type {
  CoachActionKind,
  CoachActionStatus,
  CoachActionCardModel,
  CoachActionPayload,
  CoachProposalView,
  CoachActionProgressStep,
  CoachActionRunState,
  CoachActionExecuteResult,
  CorrectWeightsExecutePayload,
  StartWorkoutExecutePayload,
  CreateDayExecutePayload,
  CreateDayExerciseInput,
} from './types'
export { COACH_PROPOSAL_TTL_MS } from './types'

export {
  insertCoachProposal,
  getCoachProposal,
  updateCoachProposalStatus,
  toProposalView,
  isProposalExpired,
  fmtWeightForUnit,
  weightsMatch,
} from './proposals'

export {
  previewCorrectWeights,
  executeCorrectWeights,
} from './correctWeights'

export {
  previewStartWorkout,
  executeStartWorkout,
} from './startWorkout'

export {
  validateCreateDayInput,
  previewCreateDay,
  executeCreateDay,
} from './createDay'

export {
  buildCoachProposalTools,
  type CoachToolContext,
} from './tools'

export {
  encodeNdjson,
  parseCoachChatStreamLine,
  shouldParseCoachNdjson,
  looksLikeCoachNdjson,
  rehydrateCoachNdjson,
  type CoachChatStreamEvent,
  type CoachActionStreamEvent,
} from './stream'
