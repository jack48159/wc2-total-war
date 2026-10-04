// One-stop export for LLM / MCP game APIs
export { getPlayerView, viewToText } from './observe.js';
export { listActions, performAction, describeActions } from './actions.js';
export { getStrategicView, getTheaterView, getArmyGroupView, getUnitView, getTileView, getOrdersView, getCommandersView, getDiplomacyView, getEventsView, getActionCatalog, previewAttack, previewOrderPath, previewOrderRisk, performCommand, performCommandBatch, autoOrganizeCountry, listCommandTypes, commandViewToText, validateOperationReason, recordOperationReason, OPERATION_REASON_MAX_LENGTH } from './command.js';
export { API_VERSION, ORDER_FIELDS, ORDER_VERBS, OPERATION_REASON_SCHEMA, COMMAND_SPECS, EXCLUDED_COMMANDS, commandCatalog, coverageReport, apiIdentity } from './catalog.js';
export { analyzeCardTargets, cardTargetRule } from './card_targets.js';
export * from './names.js';
