import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  doublePrecision,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('Operator'),
  avatarUrl: text('avatar_url'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const apiKeys = pgTable('api_keys', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  keyPrefix: text('key_prefix').notNull(),
  keyHash: text('key_hash').notNull().unique(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  lastUsedAt: timestamp('last_used_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const boardModels = pgTable('board_models', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(),
  displayName: text('display_name').notNull(),
  pcbImageUrl: text('pcb_image_url').notNull(),
  description: text('description'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const batches = pgTable('batches', {
  id: serial('id').primaryKey(),
  batchCode: text('batch_code').notNull(),
  shift: text('shift').notNull(),
  line: text('line').notNull(),
  boardModelId: integer('board_model_id')
    .references(() => boardModels.id, { onDelete: 'cascade' })
    .notNull(),
  shiftDate: text('shift_date').notNull(),
  totalInspected: integer('total_inspected').notNull().default(0),
  defectiveBoards: integer('defective_boards').notNull().default(0),
  status: text('status').notNull().default('ACTIVE'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const inspections = pgTable('inspections', {
  id: serial('id').primaryKey(),
  serialNumber: text('serial_number').notNull().unique(),
  boardModelId: integer('board_model_id')
    .references(() => boardModels.id, { onDelete: 'cascade' })
    .notNull(),
  batchId: integer('batch_id')
    .references(() => batches.id, { onDelete: 'cascade' })
    .notNull(),
  operatorId: integer('operator_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  operatorName: text('operator_name').notNull(),
  status: text('status').notNull(),
  stationId: text('station_id').notNull().default('AOI-03'),
  source: text('source').notNull().default('AOI_INGEST'),
  scanImageUrl: text('scan_image_url'),
  reviewStatus: text('review_status').notNull().default('PENDING_REVIEW'),
  reviewedBy: text('reviewed_by'),
  reviewedAt: timestamp('reviewed_at'),
  reviewNotes: text('review_notes'),
  inspectedAt: timestamp('inspected_at').defaultNow().notNull(),
});

export const defects = pgTable('defects', {
  id: serial('id').primaryKey(),
  inspectionId: integer('inspection_id')
    .references(() => inspections.id, { onDelete: 'cascade' })
    .notNull(),
  defectType: text('defect_type').notNull(),
  componentRef: text('component_ref').notNull(),
  severity: text('severity').notNull().default('CRITICAL'),
  posX: doublePrecision('pos_x').notNull(),
  posY: doublePrecision('pos_y').notNull(),
  rootCause: text('root_cause').notNull(),
  correctiveAction: text('corrective_action').notNull(),
  confidence: doublePrecision('confidence').notNull().default(0.96),
  reviewStatus: text('review_status').notNull().default('OPEN'),
  reviewedBy: text('reviewed_by'),
  reviewedAt: timestamp('reviewed_at'),
  detectedAt: timestamp('detected_at').defaultNow().notNull(),
});

export const aiInsights = pgTable('ai_insights', {
  id: serial('id').primaryKey(),
  boardModelId: integer('board_model_id').references(() => boardModels.id, {
    onDelete: 'cascade',
  }),
  batchId: integer('batch_id').references(() => batches.id, {
    onDelete: 'set null',
  }),
  filterSignature: text('filter_signature'),
  headline: text('headline').notNull(),
  recommendation: text('recommendation').notNull(),
  targetBatchCode: text('target_batch_code').notNull(),
  forecastDelta: text('forecast_delta').notNull(),
  analysisDetail: text('analysis_detail').notNull(),
  provider: text('provider'),
  modelUsed: text('model_used'),
  toolsUsed: text('tools_used'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const knowledgeDocs = pgTable('knowledge_docs', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
  category: text('category').notNull(),
  defectType: text('defect_type').notNull(),
  componentPattern: text('component_pattern').notNull().default('*'),
  content: text('content').notNull(),
  sopActions: text('sop_actions').notNull(),
  tags: text('tags').notNull().default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
