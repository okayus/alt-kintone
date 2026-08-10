-- alt-kintone のテストデータ。**手で編集しない**
-- 作り直し: pnpm alt dump --out <このファイル>
-- 中身: テーブル 9 本 + プラットフォーム 2 本、
--       データは alt seed と同一（同じ定義・同じ固定シードから作っている）
--
-- 流し方 / これが要らない場合については docs/local-setup.md

BEGIN TRANSACTION;

DROP TABLE IF EXISTS "_flow_state";
DROP TABLE IF EXISTS "_manual_check";
DROP TABLE IF EXISTS "company";
DROP TABLE IF EXISTS "contact";
DROP TABLE IF EXISTS "deal";
DROP TABLE IF EXISTS "deal_message";
DROP TABLE IF EXISTS "activity";
DROP TABLE IF EXISTS "employee";
DROP TABLE IF EXISTS "change_request";
DROP TABLE IF EXISTS "change_request_message";
DROP TABLE IF EXISTS "change_request_read";

CREATE TABLE "_flow_state" (
  "table_name" TEXT NOT NULL,
  "record_id" TEXT NOT NULL,
  "flow" TEXT NOT NULL,
  "step" TEXT NOT NULL,
  "unmet_checks" TEXT,
  "valid_from" TEXT NOT NULL,
  "valid_to" TEXT,
  "changed_by" TEXT,
  "changed_flow" TEXT,
  "changed_step" TEXT
);
CREATE UNIQUE INDEX "_flow_state_current" ON "_flow_state" ("table_name", "record_id", "flow") WHERE "valid_to" IS NULL;
CREATE TABLE "_manual_check" (
  "table_name" TEXT NOT NULL,
  "record_id" TEXT NOT NULL,
  "flow" TEXT NOT NULL,
  "step" TEXT NOT NULL,
  "check_key" TEXT NOT NULL,
  "checked" INTEGER NOT NULL,
  "checked_by" TEXT,
  "checked_at" TEXT
);
CREATE UNIQUE INDEX "_manual_check_key" ON "_manual_check" ("table_name", "record_id", "flow", "step", "check_key");
CREATE TABLE "company" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "name_kana" TEXT,
  "industry" TEXT,
  "prefecture" TEXT,
  "city" TEXT,
  "address" TEXT,
  "phone" TEXT,
  "website" TEXT,
  "lead_source" TEXT,
  "owner_employee_id" TEXT,
  "status" TEXT NOT NULL,
  "note" TEXT,
  "valid_from" TEXT NOT NULL,
  "valid_to" TEXT,
  "changed_by" TEXT,
  "changed_flow" TEXT,
  "changed_step" TEXT
);
CREATE UNIQUE INDEX "company_current" ON "company" ("id") WHERE "valid_to" IS NULL;
CREATE INDEX "company_owner_employee_id" ON "company" ("owner_employee_id");
CREATE TABLE "contact" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "title" TEXT,
  "phone" TEXT,
  "email" TEXT,
  "is_decision_maker" INTEGER NOT NULL,
  "note" TEXT,
  "valid_from" TEXT NOT NULL,
  "valid_to" TEXT,
  "changed_by" TEXT,
  "changed_flow" TEXT,
  "changed_step" TEXT
);
CREATE UNIQUE INDEX "contact_current" ON "contact" ("id") WHERE "valid_to" IS NULL;
CREATE INDEX "contact_company_id" ON "contact" ("company_id");
CREATE TABLE "deal" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "product_type" TEXT NOT NULL,
  "deal_type" TEXT NOT NULL,
  "initial_billing" INTEGER,
  "initial_profit" INTEGER,
  "monthly_billing" INTEGER,
  "monthly_profit" INTEGER,
  "contract_months" INTEGER,
  "expected_close_month" TEXT,
  "confidence" TEXT,
  "status" TEXT NOT NULL,
  "outcome_reason_category" TEXT,
  "outcome_reason_detail" TEXT,
  "competitor" TEXT,
  "owner_employee_id" TEXT NOT NULL,
  "closed_at" TEXT,
  "note" TEXT,
  "valid_from" TEXT NOT NULL,
  "valid_to" TEXT,
  "changed_by" TEXT,
  "changed_flow" TEXT,
  "changed_step" TEXT
);
CREATE UNIQUE INDEX "deal_current" ON "deal" ("id") WHERE "valid_to" IS NULL;
CREATE INDEX "deal_company_id" ON "deal" ("company_id");
CREATE INDEX "deal_owner_employee_id" ON "deal" ("owner_employee_id");
CREATE TABLE "deal_message" (
  "id" TEXT NOT NULL,
  "deal_id" TEXT NOT NULL,
  "author_employee_id" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "posted_at" TEXT NOT NULL,
  "author_kind" TEXT NOT NULL,
  "valid_from" TEXT NOT NULL,
  "valid_to" TEXT,
  "changed_by" TEXT,
  "changed_flow" TEXT,
  "changed_step" TEXT
);
CREATE UNIQUE INDEX "deal_message_current" ON "deal_message" ("id") WHERE "valid_to" IS NULL;
CREATE INDEX "deal_message_deal_id" ON "deal_message" ("deal_id");
CREATE INDEX "deal_message_author_employee_id" ON "deal_message" ("author_employee_id");
CREATE TABLE "activity" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "deal_id" TEXT,
  "contact_id" TEXT,
  "type" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "scheduled_at" TEXT,
  "completed_at" TEXT,
  "owner_employee_id" TEXT NOT NULL,
  "result" TEXT,
  "note" TEXT,
  "valid_from" TEXT NOT NULL,
  "valid_to" TEXT,
  "changed_by" TEXT,
  "changed_flow" TEXT,
  "changed_step" TEXT
);
CREATE UNIQUE INDEX "activity_current" ON "activity" ("id") WHERE "valid_to" IS NULL;
CREATE INDEX "activity_company_id" ON "activity" ("company_id");
CREATE INDEX "activity_deal_id" ON "activity" ("deal_id");
CREATE INDEX "activity_contact_id" ON "activity" ("contact_id");
CREATE INDEX "activity_owner_employee_id" ON "activity" ("owner_employee_id");
CREATE TABLE "employee" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "team" TEXT,
  "status" TEXT NOT NULL,
  "valid_from" TEXT NOT NULL,
  "valid_to" TEXT,
  "changed_by" TEXT,
  "changed_flow" TEXT,
  "changed_step" TEXT
);
CREATE UNIQUE INDEX "employee_current" ON "employee" ("id") WHERE "valid_to" IS NULL;
CREATE TABLE "change_request" (
  "id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "problem" TEXT NOT NULL,
  "wish" TEXT,
  "target_flow" TEXT,
  "target_step" TEXT,
  "target_check" TEXT,
  "target_field" TEXT,
  "target_table" TEXT,
  "target_record_id" TEXT,
  "screen_route" TEXT,
  "situation" TEXT,
  "reporter_employee_id" TEXT NOT NULL,
  "assignee_employee_id" TEXT,
  "filed_at" TEXT NOT NULL,
  "resolution" TEXT,
  "proposal" TEXT,
  "valid_from" TEXT NOT NULL,
  "valid_to" TEXT,
  "changed_by" TEXT,
  "changed_flow" TEXT,
  "changed_step" TEXT
);
CREATE UNIQUE INDEX "change_request_current" ON "change_request" ("id") WHERE "valid_to" IS NULL;
CREATE INDEX "change_request_reporter_employee_id" ON "change_request" ("reporter_employee_id");
CREATE INDEX "change_request_assignee_employee_id" ON "change_request" ("assignee_employee_id");
CREATE TABLE "change_request_message" (
  "id" TEXT NOT NULL,
  "request_id" TEXT NOT NULL,
  "author_employee_id" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "posted_at" TEXT NOT NULL,
  "author_kind" TEXT NOT NULL,
  "valid_from" TEXT NOT NULL,
  "valid_to" TEXT,
  "changed_by" TEXT,
  "changed_flow" TEXT,
  "changed_step" TEXT
);
CREATE UNIQUE INDEX "change_request_message_current" ON "change_request_message" ("id") WHERE "valid_to" IS NULL;
CREATE INDEX "change_request_message_request_id" ON "change_request_message" ("request_id");
CREATE INDEX "change_request_message_author_employee_id" ON "change_request_message" ("author_employee_id");
CREATE TABLE "change_request_read" (
  "id" TEXT NOT NULL,
  "request_id" TEXT NOT NULL,
  "employee_id" TEXT NOT NULL,
  "read_at" TEXT NOT NULL,
  "valid_from" TEXT NOT NULL,
  "valid_to" TEXT,
  "changed_by" TEXT,
  "changed_flow" TEXT,
  "changed_step" TEXT
);
CREATE UNIQUE INDEX "change_request_read_current" ON "change_request_read" ("id") WHERE "valid_to" IS NULL;
CREATE INDEX "change_request_read_request_id" ON "change_request_read" ("request_id");
CREATE INDEX "change_request_read_employee_id" ON "change_request_read" ("employee_id");

-- _flow_state: 8 件
INSERT INTO "_flow_state" ("table_name", "record_id", "flow", "step", "unmet_checks", "valid_from", "valid_to", "changed_by", "changed_flow", "changed_step") VALUES ('deal', 'd-yamada-jobad', 'sales', 'qualified', NULL, '2026-07-01T00:00:00.000Z', NULL, 'e-admin', 'sales', NULL);
INSERT INTO "_flow_state" ("table_name", "record_id", "flow", "step", "unmet_checks", "valid_from", "valid_to", "changed_by", "changed_flow", "changed_step") VALUES ('deal', 'd-aoi-meo', 'sales', 'proposed', NULL, '2026-07-01T00:00:00.000Z', NULL, 'e-admin', 'sales', NULL);
INSERT INTO "_flow_state" ("table_name", "record_id", "flow", "step", "unmet_checks", "valid_from", "valid_to", "changed_by", "changed_flow", "changed_step") VALUES ('deal', 'd-marumi-jobad', 'sales', 'contacted', NULL, '2026-07-01T00:00:00.000Z', NULL, 'e-admin', 'sales', NULL);
INSERT INTO "_flow_state" ("table_name", "record_id", "flow", "step", "unmet_checks", "valid_from", "valid_to", "changed_by", "changed_flow", "changed_step") VALUES ('deal', 'd-yamada-meo', 'sales', 'won', NULL, '2026-07-01T00:00:00.000Z', NULL, 'e-admin', 'sales', NULL);
INSERT INTO "_flow_state" ("table_name", "record_id", "flow", "step", "unmet_checks", "valid_from", "valid_to", "changed_by", "changed_flow", "changed_step") VALUES ('deal', 'd-aoi-jobad', 'sales', 'suspended', NULL, '2026-07-01T00:00:00.000Z', NULL, 'e-admin', 'sales', NULL);
INSERT INTO "_flow_state" ("table_name", "record_id", "flow", "step", "unmet_checks", "valid_from", "valid_to", "changed_by", "changed_flow", "changed_step") VALUES ('change_request', 'cr-competitor', 'request', 'triaged', NULL, '2026-07-01T00:00:00.000Z', NULL, 'e-admin', 'request', NULL);
INSERT INTO "_flow_state" ("table_name", "record_id", "flow", "step", "unmet_checks", "valid_from", "valid_to", "changed_by", "changed_flow", "changed_step") VALUES ('change_request', 'cr-proof-flow', 'request', 'filed', NULL, '2026-07-10T00:00:00.000Z', NULL, 'e-admin', 'request', NULL);
INSERT INTO "_flow_state" ("table_name", "record_id", "flow", "step", "unmet_checks", "valid_from", "valid_to", "changed_by", "changed_flow", "changed_step") VALUES ('change_request', 'cr-decision-maker', 'request', 'applied', NULL, '2026-07-10T00:00:00.000Z', NULL, 'e-admin', 'request', NULL);

-- _manual_check: 1 件
INSERT INTO "_manual_check" ("table_name", "record_id", "flow", "step", "check_key", "checked", "checked_by", "checked_at") VALUES ('deal', 'd-yamada-jobad', 'sales', 'qualified', 'problem_identified', 1, 'e-yamada', '2026-07-10T00:00:00.000Z');

-- company: 3 件
INSERT INTO "company" ("id", "name", "name_kana", "industry", "prefecture", "city", "address", "phone", "website", "lead_source", "owner_employee_id", "status", "note", "valid_from", "valid_to", "changed_by", "changed_flow", "changed_step") VALUES ('c-yamada-shokudo', '山田食堂', NULL, 'restaurant', '東京都', NULL, NULL, NULL, NULL, 'cold_call', 'e-yamada', 'prospect', NULL, '2026-07-01T00:00:00.000Z', NULL, 'e-admin', 'sales', NULL);
INSERT INTO "company" ("id", "name", "name_kana", "industry", "prefecture", "city", "address", "phone", "website", "lead_source", "owner_employee_id", "status", "note", "valid_from", "valid_to", "changed_by", "changed_flow", "changed_step") VALUES ('c-hair-aoi', 'ヘアサロン葵', NULL, 'beauty', '東京都', NULL, NULL, NULL, NULL, 'referral', 'e-yamada', 'prospect', NULL, '2026-07-01T00:00:00.000Z', NULL, 'e-admin', 'sales', NULL);
INSERT INTO "company" ("id", "name", "name_kana", "industry", "prefecture", "city", "address", "phone", "website", "lead_source", "owner_employee_id", "status", "note", "valid_from", "valid_to", "changed_by", "changed_flow", "changed_step") VALUES ('c-marumi', 'まるみ商店', NULL, 'retail', '東京都', NULL, NULL, NULL, NULL, 'web_form', 'e-yamada', 'prospect', NULL, '2026-07-01T00:00:00.000Z', NULL, 'e-admin', 'sales', NULL);

-- contact: 4 件
INSERT INTO "contact" ("id", "company_id", "name", "title", "phone", "email", "is_decision_maker", "note", "valid_from", "valid_to", "changed_by", "changed_flow", "changed_step") VALUES ('ct-yamada-owner', 'c-yamada-shokudo', '山田 健', '店主', NULL, NULL, 1, NULL, '2026-07-01T00:00:00.000Z', NULL, 'e-admin', 'sales', NULL);
INSERT INTO "contact" ("id", "company_id", "name", "title", "phone", "email", "is_decision_maker", "note", "valid_from", "valid_to", "changed_by", "changed_flow", "changed_step") VALUES ('ct-yamada-staff', 'c-yamada-shokudo', '田中 実', 'ホール責任者', NULL, NULL, 0, NULL, '2026-07-01T00:00:00.000Z', NULL, 'e-admin', 'sales', NULL);
INSERT INTO "contact" ("id", "company_id", "name", "title", "phone", "email", "is_decision_maker", "note", "valid_from", "valid_to", "changed_by", "changed_flow", "changed_step") VALUES ('ct-aoi-owner', 'c-hair-aoi', '青井 美咲', 'オーナー', NULL, NULL, 1, NULL, '2026-07-01T00:00:00.000Z', NULL, 'e-admin', 'sales', NULL);
INSERT INTO "contact" ("id", "company_id", "name", "title", "phone", "email", "is_decision_maker", "note", "valid_from", "valid_to", "changed_by", "changed_flow", "changed_step") VALUES ('ct-marumi-staff', 'c-marumi', '丸見 修', '店長', NULL, NULL, 0, NULL, '2026-07-01T00:00:00.000Z', NULL, 'e-admin', 'sales', NULL);

-- deal: 5 件
INSERT INTO "deal" ("id", "company_id", "title", "product_type", "deal_type", "initial_billing", "initial_profit", "monthly_billing", "monthly_profit", "contract_months", "expected_close_month", "confidence", "status", "outcome_reason_category", "outcome_reason_detail", "competitor", "owner_employee_id", "closed_at", "note", "valid_from", "valid_to", "changed_by", "changed_flow", "changed_step") VALUES ('d-yamada-jobad', 'c-yamada-shokudo', '山田食堂 ホールスタッフ求人', 'job_ad', 'new', 180000, 54000, NULL, NULL, NULL, NULL, NULL, 'open', NULL, NULL, NULL, 'e-yamada', NULL, NULL, '2026-07-01T00:00:00.000Z', NULL, 'e-admin', 'sales', 'qualified');
INSERT INTO "deal" ("id", "company_id", "title", "product_type", "deal_type", "initial_billing", "initial_profit", "monthly_billing", "monthly_profit", "contract_months", "expected_close_month", "confidence", "status", "outcome_reason_category", "outcome_reason_detail", "competitor", "owner_employee_id", "closed_at", "note", "valid_from", "valid_to", "changed_by", "changed_flow", "changed_step") VALUES ('d-aoi-meo', 'c-hair-aoi', 'ヘアサロン葵 MEO運用', 'meo', 'new', NULL, NULL, 30000, 18000, 12, '2026-08', 'A', 'open', NULL, NULL, NULL, 'e-yamada', NULL, NULL, '2026-07-01T00:00:00.000Z', NULL, 'e-admin', 'sales', 'proposed');
INSERT INTO "deal" ("id", "company_id", "title", "product_type", "deal_type", "initial_billing", "initial_profit", "monthly_billing", "monthly_profit", "contract_months", "expected_close_month", "confidence", "status", "outcome_reason_category", "outcome_reason_detail", "competitor", "owner_employee_id", "closed_at", "note", "valid_from", "valid_to", "changed_by", "changed_flow", "changed_step") VALUES ('d-marumi-jobad', 'c-marumi', 'まるみ商店 レジスタッフ求人', 'job_ad', 'new', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'open', NULL, NULL, NULL, 'e-sato', NULL, NULL, '2026-07-01T00:00:00.000Z', NULL, 'e-admin', 'sales', 'contacted');
INSERT INTO "deal" ("id", "company_id", "title", "product_type", "deal_type", "initial_billing", "initial_profit", "monthly_billing", "monthly_profit", "contract_months", "expected_close_month", "confidence", "status", "outcome_reason_category", "outcome_reason_detail", "competitor", "owner_employee_id", "closed_at", "note", "valid_from", "valid_to", "changed_by", "changed_flow", "changed_step") VALUES ('d-yamada-meo', 'c-yamada-shokudo', '山田食堂 MEO運用', 'meo', 'expansion', NULL, NULL, 25000, 15000, 6, '2026-07', 'B', 'won', NULL, NULL, NULL, 'e-sato', '2026-07-08', NULL, '2026-07-01T00:00:00.000Z', NULL, 'e-admin', 'sales', 'won');
INSERT INTO "deal" ("id", "company_id", "title", "product_type", "deal_type", "initial_billing", "initial_profit", "monthly_billing", "monthly_profit", "contract_months", "expected_close_month", "confidence", "status", "outcome_reason_category", "outcome_reason_detail", "competitor", "owner_employee_id", "closed_at", "note", "valid_from", "valid_to", "changed_by", "changed_flow", "changed_step") VALUES ('d-aoi-jobad', 'c-hair-aoi', 'ヘアサロン葵 スタイリスト求人', 'job_ad', 'new', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'suspended', NULL, NULL, NULL, 'e-yamada', NULL, NULL, '2026-07-01T00:00:00.000Z', NULL, 'e-admin', 'sales', 'suspended');

-- deal_message: 3 件
INSERT INTO "deal_message" ("id", "deal_id", "author_employee_id", "body", "posted_at", "author_kind", "valid_from", "valid_to", "changed_by", "changed_flow", "changed_step") VALUES ('dm-1', 'd-aoi-meo', 'e-suzuki', '月額3万で12ヶ月なら粗利率は悪くない。決裁者に会えていないのが気になるので、次回はオーナー同席で', '2026-07-10T00:00:00.000Z', 'human', '2026-07-10T00:00:00.000Z', NULL, 'e-admin', 'sales', NULL);
INSERT INTO "deal_message" ("id", "deal_id", "author_employee_id", "body", "posted_at", "author_kind", "valid_from", "valid_to", "changed_by", "changed_flow", "changed_step") VALUES ('dm-2', 'd-yamada-meo', 'e-sato', '受注しました。初期設定の連絡先は店主の山田さんです。既存の求人広告と同じ窓口なので、そちらの履歴も見てください', '2026-07-10T00:00:00.000Z', 'human', '2026-07-10T00:00:00.000Z', NULL, 'e-admin', 'sales', NULL);
INSERT INTO "deal_message" ("id", "deal_id", "author_employee_id", "body", "posted_at", "author_kind", "valid_from", "valid_to", "changed_by", "changed_flow", "changed_step") VALUES ('dm-3', 'd-yamada-meo', 'e-kubo', '了解しました。今週中に初期設定に入ります', '2026-07-10T00:00:00.000Z', 'human', '2026-07-10T00:00:00.000Z', NULL, 'e-admin', 'sales', NULL);

-- activity: 6 件
INSERT INTO "activity" ("id", "company_id", "deal_id", "contact_id", "type", "subject", "scheduled_at", "completed_at", "owner_employee_id", "result", "note", "valid_from", "valid_to", "changed_by", "changed_flow", "changed_step") VALUES ('a-1', 'c-yamada-shokudo', 'd-yamada-jobad', 'ct-yamada-owner', 'call', '初回架電', NULL, '2026-07-01T01:00:00.000Z', 'e-yamada', 'appointment', NULL, '2026-07-01T00:00:00.000Z', NULL, 'e-admin', 'sales', NULL);
INSERT INTO "activity" ("id", "company_id", "deal_id", "contact_id", "type", "subject", "scheduled_at", "completed_at", "owner_employee_id", "result", "note", "valid_from", "valid_to", "changed_by", "changed_flow", "changed_step") VALUES ('a-2', 'c-yamada-shokudo', 'd-yamada-jobad', 'ct-yamada-owner', 'visit', '訪問ヒアリング', '2026-07-20T02:00:00.000Z', NULL, 'e-yamada', NULL, NULL, '2026-07-01T00:00:00.000Z', NULL, 'e-admin', 'sales', NULL);
INSERT INTO "activity" ("id", "company_id", "deal_id", "contact_id", "type", "subject", "scheduled_at", "completed_at", "owner_employee_id", "result", "note", "valid_from", "valid_to", "changed_by", "changed_flow", "changed_step") VALUES ('a-3', 'c-hair-aoi', 'd-aoi-meo', 'ct-aoi-owner', 'online_meeting', 'MEO提案', NULL, '2026-07-05T05:00:00.000Z', 'e-yamada', 'advanced', NULL, '2026-07-01T00:00:00.000Z', NULL, 'e-admin', 'sales', NULL);
INSERT INTO "activity" ("id", "company_id", "deal_id", "contact_id", "type", "subject", "scheduled_at", "completed_at", "owner_employee_id", "result", "note", "valid_from", "valid_to", "changed_by", "changed_flow", "changed_step") VALUES ('a-4', 'c-marumi', 'd-marumi-jobad', 'ct-marumi-staff', 'call', 'テレアポ', NULL, '2026-07-06T00:30:00.000Z', 'e-sato', 'connected', NULL, '2026-07-01T00:00:00.000Z', NULL, 'e-admin', 'sales', NULL);
INSERT INTO "activity" ("id", "company_id", "deal_id", "contact_id", "type", "subject", "scheduled_at", "completed_at", "owner_employee_id", "result", "note", "valid_from", "valid_to", "changed_by", "changed_flow", "changed_step") VALUES ('a-5', 'c-marumi', 'd-marumi-jobad', NULL, 'visit', '初回訪問', '2026-07-25T04:00:00.000Z', NULL, 'e-sato', NULL, NULL, '2026-07-01T00:00:00.000Z', NULL, 'e-admin', 'sales', NULL);
INSERT INTO "activity" ("id", "company_id", "deal_id", "contact_id", "type", "subject", "scheduled_at", "completed_at", "owner_employee_id", "result", "note", "valid_from", "valid_to", "changed_by", "changed_flow", "changed_step") VALUES ('a-6', 'c-yamada-shokudo', 'd-yamada-meo', 'ct-yamada-owner', 'visit', '受注', NULL, '2026-07-08T06:00:00.000Z', 'e-sato', 'won', NULL, '2026-07-01T00:00:00.000Z', NULL, 'e-admin', 'sales', NULL);

-- employee: 6 件
INSERT INTO "employee" ("id", "name", "email", "role", "team", "status", "valid_from", "valid_to", "changed_by", "changed_flow", "changed_step") VALUES ('e-yamada', '山田 太郎', 'yamada@example.com', 'sales_rep', '第1営業部', 'active', '2026-07-01T00:00:00.000Z', NULL, 'e-admin', 'sales', NULL);
INSERT INTO "employee" ("id", "name", "email", "role", "team", "status", "valid_from", "valid_to", "changed_by", "changed_flow", "changed_step") VALUES ('e-sato', '佐藤 花子', 'sato@example.com', 'sales_rep', '第1営業部', 'active', '2026-07-01T00:00:00.000Z', NULL, 'e-admin', 'sales', NULL);
INSERT INTO "employee" ("id", "name", "email", "role", "team", "status", "valid_from", "valid_to", "changed_by", "changed_flow", "changed_step") VALUES ('e-suzuki', '鈴木 一郎', 'suzuki@example.com', 'sales_manager', '第1営業部', 'active', '2026-07-01T00:00:00.000Z', NULL, 'e-admin', 'sales', NULL);
INSERT INTO "employee" ("id", "name", "email", "role", "team", "status", "valid_from", "valid_to", "changed_by", "changed_flow", "changed_step") VALUES ('e-mori', '森 次郎', 'mori@example.com', 'production', '第1営業部', 'active', '2026-07-01T00:00:00.000Z', NULL, 'e-admin', 'sales', NULL);
INSERT INTO "employee" ("id", "name", "email", "role", "team", "status", "valid_from", "valid_to", "changed_by", "changed_flow", "changed_step") VALUES ('e-kubo', '久保 綾', 'kubo@example.com', 'meo_operator', '第1営業部', 'active', '2026-07-01T00:00:00.000Z', NULL, 'e-admin', 'sales', NULL);
INSERT INTO "employee" ("id", "name", "email", "role", "team", "status", "valid_from", "valid_to", "changed_by", "changed_flow", "changed_step") VALUES ('e-admin', '管理者', 'admin@example.com', 'admin', '第1営業部', 'active', '2026-07-01T00:00:00.000Z', NULL, 'e-admin', 'sales', NULL);

-- change_request: 3 件
INSERT INTO "change_request" ("id", "kind", "problem", "wish", "target_flow", "target_step", "target_check", "target_field", "target_table", "target_record_id", "screen_route", "situation", "reporter_employee_id", "assignee_employee_id", "filed_at", "resolution", "proposal", "valid_from", "valid_to", "changed_by", "changed_flow", "changed_step") VALUES ('cr-competitor', 'cannot_record', '失注したとき、どこに負けたかを後から集計できない。競合先の欄はあるが提案の段階では空のままで、失注してから思い出して書いている', '提案のときに競合先を入れる場所がほしい', 'sales', 'sales.proposed', NULL, 'deal.competitor', 'deal', 'd-aoi-meo', '#/deals/d-aoi-meo', '{"unmetChecks":["decision_maker_met"]}', 'e-yamada', 'e-admin', '2026-07-01T00:00:00.000Z', NULL, NULL, '2026-07-01T00:00:00.000Z', NULL, 'e-admin', 'request', 'triaged');
INSERT INTO "change_request" ("id", "kind", "problem", "wish", "target_flow", "target_step", "target_check", "target_field", "target_table", "target_record_id", "screen_route", "situation", "reporter_employee_id", "assignee_employee_id", "filed_at", "resolution", "proposal", "valid_from", "valid_to", "changed_by", "changed_flow", "changed_step") VALUES ('cr-proof-flow', 'new_business', '原稿の入稿までの進み具合をどこにも記録できていない。いまは制作チームのスプレッドシートで、営業から「あの案件どうなってる」と毎回聞かれる', NULL, 'sales', NULL, NULL, NULL, 'deal', NULL, '#/flows/sales', NULL, 'e-mori', NULL, '2026-07-10T00:00:00.000Z', NULL, NULL, '2026-07-10T00:00:00.000Z', NULL, 'e-admin', 'request', 'filed');
INSERT INTO "change_request" ("id", "kind", "problem", "wish", "target_flow", "target_step", "target_check", "target_field", "target_table", "target_record_id", "screen_route", "situation", "reporter_employee_id", "assignee_employee_id", "filed_at", "resolution", "proposal", "valid_from", "valid_to", "changed_by", "changed_flow", "changed_step") VALUES ('cr-decision-maker', 'exit_mismatch', '「決裁者を特定した」が、店主が一人でやっている店だと最初から満たされてしまい、確認したことにならない', NULL, 'sales', 'sales.qualified', 'sales.qualified.decision_maker_identified', NULL, 'deal', NULL, '#/flows/sales?step=qualified', NULL, 'e-suzuki', 'e-admin', '2026-07-10T00:00:00.000Z', '充足のしかた（howTo）に「一人店舗でも面談で確認したうえで登録する」を足した', NULL, '2026-07-10T00:00:00.000Z', NULL, 'e-admin', 'request', 'applied');

-- change_request_message: 2 件
INSERT INTO "change_request_message" ("id", "request_id", "author_employee_id", "body", "posted_at", "author_kind", "valid_from", "valid_to", "changed_by", "changed_flow", "changed_step") VALUES ('crm-1', 'cr-competitor', 'e-admin', '提案ステップの入力欄に競合先を出す方向で考えています。「まだ分からない」も選べたほうがよいですか？', '2026-07-10T00:00:00.000Z', 'human', '2026-07-10T00:00:00.000Z', NULL, 'e-admin', 'request', NULL);
INSERT INTO "change_request_message" ("id", "request_id", "author_employee_id", "body", "posted_at", "author_kind", "valid_from", "valid_to", "changed_by", "changed_flow", "changed_step") VALUES ('crm-2', 'cr-decision-maker', 'e-admin', '条件そのものは変えず、充足のしかたの説明を直しました。次のヨミ会で見てみてください', '2026-07-10T00:00:00.000Z', 'human', '2026-07-10T00:00:00.000Z', NULL, 'e-admin', 'request', NULL);

-- change_request_read: 1 件
INSERT INTO "change_request_read" ("id", "request_id", "employee_id", "read_at", "valid_from", "valid_to", "changed_by", "changed_flow", "changed_step") VALUES ('crr-1', 'cr-competitor', 'e-yamada', '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z', NULL, 'e-admin', 'request', NULL);

COMMIT;
