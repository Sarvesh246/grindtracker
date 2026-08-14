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
  CoachSessionLogRow,
  LogBodyWeightExecutePayload,
  DeleteBodyWeightExecutePayload,
  FinishWorkoutExecutePayload,
  UndoFinishWorkoutExecutePayload,
  SkipSetsExecutePayload,
  ToggleRestTodayExecutePayload,
  SetRestWeekdayExecutePayload,
  EditExerciseExecutePayload,
  UpdateRotationExecutePayload,
  EditSessionLogExecutePayload,
  UpdateNotificationPrefsExecutePayload,
  NotificationPrefsPatch,
} from './types'
export { COACH_PROPOSAL_TTL_MS, COACH_PROPOSAL_INSERT_FAILED } from './types'

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
  formatCorrectWeightsMessage,
  type CorrectWeightsFailedSession,
  type CorrectWeightsResult,
  type CorrectWeightsStepState,
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

export { pickExerciseByName, resolveExerciseByName, normalizeName } from './resolveExercise'

export { validateLogBodyWeightInput, previewLogBodyWeight, executeLogBodyWeight } from './logBodyWeight'
export { previewDeleteBodyWeight, executeDeleteBodyWeight } from './deleteBodyWeight'
export { previewFinishWorkout, executeFinishWorkout } from './finishWorkout'
export { previewUndoFinishWorkout, executeUndoFinishWorkout } from './undoFinishWorkout'
export { validateSkipSetsInput, previewSkipSets, executeSkipSets } from './skipSets'
export { previewToggleRestToday, executeToggleRestToday } from './toggleRestToday'
export {
  validateSetRestWeekdayInput,
  previewSetRestWeekday,
  executeSetRestWeekday,
} from './setRestWeekday'
export {
  validateEditExerciseInput,
  previewEditExercise,
  executeEditExercise,
} from './editExercise'
export {
  validateUpdateRotationInput,
  previewUpdateRotation,
  executeUpdateRotation,
} from './updateRotation'
export {
  applySessionLogEdit,
  validateSessionLogEditPatch,
  previewEditSessionLog,
  executeEditSessionLog,
  type SessionLogEditPatch,
} from './editSessionLog'
export {
  previewUpdateNotificationPrefs,
  executeUpdateNotificationPrefs,
} from './updateNotificationPrefs'

export { executeConfirmedPayload, type ConfirmedActionResult } from './dispatch'

export {
  parseCalendarDateKey,
  parseDayOfWeek,
  dayOfWeekFromDateKey,
  DOW_LABELS,
} from './dates'

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
