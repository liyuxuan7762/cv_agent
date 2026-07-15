'use strict';

const { Pool } = require('pg');

// ── 数据库连接配置 ────────────────────────────────────────────────
const DB_NAME = process.env.PGDATABASE || 'resume';

const adminPool = new Pool({
  host:     process.env.PGHOST           || '192.168.123.171',
  port:     Number(process.env.PGPORT    || 5432),
  database: process.env.PGADMIN_DATABASE || 'postgres',
  user:     process.env.PGUSER           || 'postgres',
  password: process.env.PGPASSWORD       || 'postgres',
});

const pool = new Pool({
  host:     process.env.PGHOST        || '192.168.123.171',
  port:     Number(process.env.PGPORT || 5432),
  database: DB_NAME,
  user:     process.env.PGUSER        || 'postgres',
  password: process.env.PGPASSWORD    || 'postgres',
});

// ── 工具函数 ──────────────────────────────────────────────────────
function quoteIdentifier(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`;
}

// ── 确保数据库存在 ────────────────────────────────────────────────
async function ensureDatabaseExists() {
  const result = await adminPool.query(
    `SELECT 1 FROM pg_database WHERE datname = $1`,
    [DB_NAME]
  );
  if (result.rowCount === 0) {
    console.log(`Database "${DB_NAME}" does not exist. Creating...`);
    await adminPool.query(`CREATE DATABASE ${quoteIdentifier(DB_NAME)};`);
    console.log(`Database "${DB_NAME}" created.`);
  } else {
    console.log(`Database "${DB_NAME}" already exists.`);
  }
  await adminPool.end();
}

// ── 建表 DDL ─────────────────────────────────────────────────────
const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS skill_dictionary (
    id           BIGSERIAL    PRIMARY KEY,
    skill_name   VARCHAR(100) NOT NULL UNIQUE,
    aliases      TEXT[]       NOT NULL DEFAULT '{}',
    related_terms TEXT[]      NOT NULL DEFAULT '{}',
    category     VARCHAR(100),
    weight       INT          NOT NULL DEFAULT 1,
    created_at   TIMESTAMP    NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMP    NOT NULL DEFAULT NOW()
  );
`;

// ── 第一批最小技能字典数据 ────────────────────────────────────────
//
// 本阶段只维护三条核心记录，验证 Spring Boot 归一化能力：
//   SpringBoot / springboot / spring boot  →  Spring Boot
//
const SKILL_DICTIONARY_ROWS = [
  {
    skill_name:    'Java',
    aliases:       ['J2EE', 'Java后端'],
    related_terms: ['Spring Boot', 'Spring Cloud', 'MyBatis', '微服务'],
    category:      '后端开发',
    weight:        5,
  },
  {
    skill_name:    'Spring Boot',
    aliases:       ['SpringBoot', 'springboot', 'spring boot'],
    related_terms: ['Java', 'Spring Cloud', '微服务'],
    category:      '后端开发',
    weight:        5,
  },
  {
    skill_name:    '微服务',
    aliases:       ['Microservices', 'microservice'],
    related_terms: ['Java', 'Spring Boot', 'Spring Cloud'],
    category:      '架构',
    weight:        4,
  },
];

// ── 建表 ──────────────────────────────────────────────────────────
async function createTable() {
  await pool.query(CREATE_TABLE_SQL);
  console.log('Table skill_dictionary is ready.');
}

// ── Upsert 单条字典记录 ───────────────────────────────────────────
async function upsertSkill(row) {
  const sql = `
    INSERT INTO skill_dictionary
      (skill_name, aliases, related_terms, category, weight)
    VALUES
      ($1, $2, $3, $4, $5)
    ON CONFLICT (skill_name) DO UPDATE SET
      aliases       = EXCLUDED.aliases,
      related_terms = EXCLUDED.related_terms,
      category      = EXCLUDED.category,
      weight        = EXCLUDED.weight,
      updated_at    = NOW();
  `;

  await pool.query(sql, [
    row.skill_name,
    row.aliases,
    row.related_terms,
    row.category,
    row.weight,
  ]);
}

// ── 插入 / 更新所有字典数据 ───────────────────────────────────────
async function seedSkillDictionary() {
  for (const row of SKILL_DICTIONARY_ROWS) {
    await upsertSkill(row);
    console.log(`  Upserted skill: "${row.skill_name}"`);
  }
}

// ── 验证：打印 Spring Boot 记录 ───────────────────────────────────
async function verifySeedResult() {
  const countResult = await pool.query(
    `SELECT COUNT(*) AS total FROM skill_dictionary;`
  );
  console.log(`\nTotal records in skill_dictionary: ${countResult.rows[0].total}`);

  const springBootResult = await pool.query(
    `SELECT skill_name, aliases, related_terms, category, weight
     FROM skill_dictionary
     WHERE skill_name = 'Spring Boot';`
  );

  if (springBootResult.rowCount === 0) {
    console.error('Verification FAILED: "Spring Boot" record not found.');
    return;
  }

  const sb = springBootResult.rows[0];
  console.log('\n[Verification] Spring Boot record:');
  console.log(`  skill_name   : ${sb.skill_name}`);
  console.log(`  aliases      : ${JSON.stringify(sb.aliases)}`);
  console.log(`  related_terms: ${JSON.stringify(sb.related_terms)}`);
  console.log(`  category     : ${sb.category}`);
  console.log(`  weight       : ${sb.weight}`);

  // 别名覆盖检查
  const requiredAliases = ['SpringBoot', 'springboot', 'spring boot'];
  const missingAliases = requiredAliases.filter(a => !sb.aliases.includes(a));
  if (missingAliases.length > 0) {
    console.error(`  Verification FAILED: missing aliases: ${missingAliases.join(', ')}`);
  } else {
    console.log('  aliases check : PASSED');
  }

  // related_terms 检查
  const requiredRelated = ['Java', 'Spring Cloud', '微服务'];
  const missingRelated = requiredRelated.filter(t => !sb.related_terms.includes(t));
  if (missingRelated.length > 0) {
    console.error(`  Verification FAILED: missing related_terms: ${missingRelated.join(', ')}`);
  } else {
    console.log('  related_terms check: PASSED');
  }
}

// ── 主流程 ───────────────────────────────────────────────────────
async function main() {
  try {
    await ensureDatabaseExists();

    console.log(`Connecting to PostgreSQL database: ${DB_NAME}`);

    await createTable();
    await seedSkillDictionary();
    await verifySeedResult();

    console.log('\nskill_dictionary seeded successfully.');
  } catch (error) {
    console.error('Failed to seed skill_dictionary:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();