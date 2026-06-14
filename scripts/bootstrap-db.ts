#!/usr/bin/env bun
/**
 * Bootstrap: create all tables from schema using raw SQL.
 * Run once on fresh installs where drizzle/ migrations don't exist.
 */
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";

const dbPath = process.env.DATABASE_PATH || "./data/poolprox3.db";
const dir = dbPath.replace(/[/\\][^/\\]+$/, "");
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

const db = new Database(dbPath);
db.exec("PRAGMA journal_mode = WAL;");

const statements = [
  `CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    email TEXT NOT NULL,
    password TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    enabled INTEGER NOT NULL DEFAULT 1,
    tokens TEXT,
    quota_limit REAL DEFAULT 0,
    quota_remaining REAL DEFAULT 0,
    quota_reset_at INTEGER,
    last_used_at INTEGER,
    last_login_at INTEGER,
    error_message TEXT,
    metadata TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS accounts_provider_email_idx ON accounts(provider, email)`,

  `CREATE TABLE IF NOT EXISTS request_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER REFERENCES accounts(id),
    provider TEXT NOT NULL,
    model TEXT,
    prompt_tokens INTEGER DEFAULT 0,
    completion_tokens INTEGER DEFAULT 0,
    total_tokens INTEGER DEFAULT 0,
    credits_used REAL DEFAULT 0,
    status TEXT NOT NULL,
    duration_ms INTEGER,
    error_message TEXT,
    request_body TEXT,
    response_body TEXT,
    account_email TEXT,
    account_quota_before REAL DEFAULT 0,
    account_quota_after REAL DEFAULT 0,
    compression_stats TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS request_logs_created_at_idx ON request_logs(created_at)`,
  `CREATE INDEX IF NOT EXISTS request_logs_status_created_at_idx ON request_logs(status, created_at)`,
  `CREATE INDEX IF NOT EXISTS request_logs_provider_created_at_idx ON request_logs(provider, created_at)`,
  `CREATE INDEX IF NOT EXISTS request_logs_provider_model_status_idx ON request_logs(provider, model, status)`,
  `CREATE INDEX IF NOT EXISTS request_logs_account_idx ON request_logs(account_id)`,

  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at INTEGER
  )`,

  `CREATE TABLE IF NOT EXISTS usage_summary (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bucket TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    total_requests INTEGER DEFAULT 0,
    success_requests INTEGER DEFAULT 0,
    error_requests INTEGER DEFAULT 0,
    prompt_tokens INTEGER DEFAULT 0,
    completion_tokens INTEGER DEFAULT 0,
    total_tokens INTEGER DEFAULT 0,
    credits_used REAL DEFAULT 0,
    total_duration_ms INTEGER DEFAULT 0
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS usage_summary_bucket_provider_model_idx ON usage_summary(bucket, provider, model)`,
  `CREATE INDEX IF NOT EXISTS usage_summary_bucket_idx ON usage_summary(bucket)`,
  `CREATE INDEX IF NOT EXISTS usage_summary_provider_idx ON usage_summary(provider, bucket)`,

  `CREATE TABLE IF NOT EXISTS vcc_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number TEXT NOT NULL,
    exp_month TEXT NOT NULL,
    exp_year TEXT NOT NULL,
    cvv TEXT NOT NULL,
    name TEXT DEFAULT 'John Doe',
    status TEXT NOT NULL DEFAULT 'active',
    used_by_account_id INTEGER REFERENCES accounts(id),
    created_at INTEGER NOT NULL,
    updated_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS vcc_cards_status_idx ON vcc_cards(status)`,

  `CREATE TABLE IF NOT EXISTS vcc_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER REFERENCES accounts(id),
    card_last4 TEXT NOT NULL,
    card_brand TEXT,
    amount REAL,
    currency TEXT DEFAULT 'usd',
    status TEXT NOT NULL,
    stripe_charge_id TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS vcc_transactions_account_idx ON vcc_transactions(account_id)`,
  `CREATE INDEX IF NOT EXISTS vcc_transactions_status_idx ON vcc_transactions(status)`,

  `CREATE TABLE IF NOT EXISTS image_studio_chats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    messages TEXT NOT NULL DEFAULT '[]',
    final_prompt TEXT,
    options TEXT DEFAULT '[]',
    assist_model TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS image_studio_chats_updated_at_idx ON image_studio_chats(updated_at)`,

  `CREATE TABLE IF NOT EXISTS image_studio_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER REFERENCES image_studio_chats(id) ON DELETE SET NULL,
    prompt TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'image',
    aspect_ratio TEXT NOT NULL DEFAULT '1:1',
    n INTEGER NOT NULL DEFAULT 1,
    urls TEXT NOT NULL DEFAULT '[]',
    credits_used REAL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS image_studio_results_created_at_idx ON image_studio_results(created_at)`,
  `CREATE INDEX IF NOT EXISTS image_studio_results_chat_idx ON image_studio_results(chat_id)`,

  `CREATE TABLE IF NOT EXISTS filter_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_id TEXT NOT NULL UNIQUE,
    pattern TEXT NOT NULL,
    replacement TEXT NOT NULL DEFAULT '',
    is_active INTEGER NOT NULL DEFAULT 1,
    is_regex INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS filter_rules_sort_order_idx ON filter_rules(sort_order)`,

  `CREATE TABLE IF NOT EXISTS proxy_pool (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'http',
    label TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    last_used_at INTEGER,
    last_checked_at INTEGER,
    error_message TEXT,
    latency_ms INTEGER,
    success_count INTEGER DEFAULT 0,
    fail_count INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS proxy_pool_status_idx ON proxy_pool(status)`,

  `CREATE TABLE IF NOT EXISTS model_mappings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_pattern TEXT NOT NULL,
    match_type TEXT NOT NULL DEFAULT 'contains',
    target_model TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    priority INTEGER NOT NULL DEFAULT 0,
    label TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS model_mappings_priority_idx ON model_mappings(priority)`,
];

let ok = 0;
for (const sql of statements) {
  try {
    db.exec(sql);
    ok++;
  } catch (e) {
    console.error("FAIL:", sql.slice(0, 80), e);
  }
}

db.close();
console.log(`[bootstrap] ${ok}/${statements.length} statements executed on ${dbPath}`);
