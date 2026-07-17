'use strict';

const { Pool } = require('pg');

// ── 数据库连接配置 ────────────────────────────────────────────────
const DB_NAME = process.env.PGDATABASE || 'resume';

const pool = new Pool({
  host:     process.env.PGHOST        || '192.168.123.171',
  port:     Number(process.env.PGPORT || 5432),
  database: DB_NAME,
  user:     process.env.PGUSER        || 'postgres',
  password: process.env.PGPASSWORD    || 'postgres',
});

// ── 建表 & 索引 ───────────────────────────────────────────────────
async function createIndexTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS candidate_search_index (
      user_id          VARCHAR(50)  PRIMARY KEY,
      name             VARCHAR(100),
      gender           VARCHAR(20),
      birthdate        DATE,
      aim_salary       VARCHAR(100),
      applied_at       TIMESTAMP,
      latest_company   VARCHAR(200),
      latest_title     VARCHAR(200),
      full_text        TEXT,
      matched_skills   TEXT[]    NOT NULL DEFAULT '{}',
      highest_degree   VARCHAR(20),
      matched_companies TEXT[]   NOT NULL DEFAULT '{}',
      company_tags     TEXT[]    NOT NULL DEFAULT '{}',
      created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  // 兜底：对已存在的旧表补充缺失字段
  await pool.query(`
    ALTER TABLE candidate_search_index
      ADD COLUMN IF NOT EXISTS highest_degree    VARCHAR(20);
  `);
  await pool.query(`
    ALTER TABLE candidate_search_index
      ADD COLUMN IF NOT EXISTS matched_companies TEXT[] NOT NULL DEFAULT '{}';
  `);
  await pool.query(`
    ALTER TABLE candidate_search_index
      ADD COLUMN IF NOT EXISTS company_tags TEXT[] NOT NULL DEFAULT '{}';
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_csi_matched_skills
      ON candidate_search_index USING GIN(matched_skills);

    CREATE INDEX IF NOT EXISTS idx_csi_gender
      ON candidate_search_index(gender);

    CREATE INDEX IF NOT EXISTS idx_csi_birthdate
      ON candidate_search_index(birthdate);

    CREATE INDEX IF NOT EXISTS idx_csi_highest_degree
      ON candidate_search_index(highest_degree);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_csi_matched_companies
      ON candidate_search_index USING GIN(matched_companies);

    CREATE INDEX IF NOT EXISTS idx_csi_company_tags
      ON candidate_search_index USING GIN(company_tags);
  `);

  console.log('Table candidate_search_index is ready.');
}

// ── 读取技能字典 ──────────────────────────────────────────────────
async function loadSkillDictionary() {
  const result = await pool.query(`
    SELECT skill_name, aliases
    FROM skill_dictionary
  `);

  return result.rows.map(row => ({
    skillName: row.skill_name,
    terms: unique([
      row.skill_name,
      ...(row.aliases || []),
    ]),
  }));
}

// ── 读取公司字典 ──────────────────────────────────────────────────
async function loadCompanyDictionary() {
  const result = await pool.query(`
    SELECT company_name, aliases, tags
    FROM company_dictionary
  `);

  return result.rows.map(row => ({
    companyName: row.company_name,
    // 匹配词：标准名 + 所有别名
    terms: unique([
      row.company_name,
      ...(row.aliases || []),
    ]),
    tags: row.tags || [],
  }));
}

// ── 工具函数 ──────────────────────────────────────────────────────
function unique(arr) {
  return [...new Set(arr.filter(Boolean))];
}

function includesTerm(text, term) {
  if (!text || !term) return false;
  return text.toLowerCase().includes(term.toLowerCase());
}

function safeParseExperience(experienceIf) {
  try {
    const parsed = JSON.parse(experienceIf);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function safeParseEducation(educationField) {
  try {
    const parsed = JSON.parse(educationField);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ── 构建 full_text ────────────────────────────────────────────────
function buildFullText(resume, experiences, educations) {
  const parts = [
    resume.name,
    resume.personal,
    ...experiences.flatMap(exp => [
      exp.company,
      exp.title,
      exp.summary,
    ]),
    ...educations.flatMap(edu => [
      edu.school,
      edu.major,
      edu.description,
    ]),
  ];
  return parts.filter(Boolean).join('\n');
}

// ── 技能匹配 ──────────────────────────────────────────────────────
function findMatchedSkills(fullText, skillDict) {
  const matched = [];
  for (const skill of skillDict) {
    const hit = skill.terms.some(term => includesTerm(fullText, term));
    if (hit) {
      matched.push(skill.skillName);
    }
  }
  return unique(matched);
}

// ── 公司匹配 ──────────────────────────────────────────────────────
// 规则：
//   1. 对每家公司，检查 company_name 或任意 alias 是否出现在 full_text 中
//   2. 命中则将标准 company_name 写入 matched_companies
//   3. 将该公司 tags 合并写入 company_tags
//   4. matched_companies 和 company_tags 均去重
function findMatchedCompanies(fullText, companyDict) {
  const matchedCompanies = [];
  const companyTagsSet   = new Set();

  for (const company of companyDict) {
    const hit = company.terms.some(term => includesTerm(fullText, term));
    if (hit) {
      matchedCompanies.push(company.companyName);
      company.tags.forEach(tag => companyTagsSet.add(tag));
    }
  }

  return {
    matchedCompanies: unique(matchedCompanies),
    companyTags:      [...companyTagsSet],
  };
}

// ── 提取最高学历 ──────────────────────────────────────────────────
const DEGREE_RANK = {
  '博士研究生': 4,
  '硕士研究生': 3,
  '本科':       2,
  '专科':       1,
};

function extractHighestDegree(educations) {
  if (!educations.length) return null;

  let highest = null;
  let highestRank = 0;

  for (const edu of educations) {
    const rank = DEGREE_RANK[edu.degree] || 0;
    if (rank > highestRank) {
      highestRank = rank;
      highest = edu.degree;
    }
  }

  return highest;
}

// ── 提取最近工作经历 ──────────────────────────────────────────────
function getLatestExperience(experiences) {
  if (!experiences.length) return null;

  const sorted = [...experiences].sort((a, b) => {
    const aEnd = a.endDate === '至今' ? '9999-12-31' : (a.endDate || '0000-01-01');
    const bEnd = b.endDate === '至今' ? '9999-12-31' : (b.endDate || '0000-01-01');
    return bEnd.localeCompare(aEnd);
  });

  return sorted[0];
}

// ── Upsert 单条索引记录 ───────────────────────────────────────────
async function upsertCandidateIndex(row) {
  await pool.query(
    `
    INSERT INTO candidate_search_index (
      user_id, name, gender, birthdate,
      aim_salary, applied_at,
      latest_company, latest_title,
      full_text, matched_skills,
      highest_degree,
      matched_companies, company_tags,
      created_at, updated_at
    )
    VALUES (
      $1, $2, $3, $4,
      $5, $6,
      $7, $8,
      $9, $10,
      $11,
      $12, $13,
      NOW(), NOW()
    )
    ON CONFLICT (user_id) DO UPDATE SET
      name              = EXCLUDED.name,
      gender            = EXCLUDED.gender,
      birthdate         = EXCLUDED.birthdate,
      aim_salary        = EXCLUDED.aim_salary,
      applied_at        = EXCLUDED.applied_at,
      latest_company    = EXCLUDED.latest_company,
      latest_title      = EXCLUDED.latest_title,
      full_text         = EXCLUDED.full_text,
      matched_skills    = EXCLUDED.matched_skills,
      highest_degree    = EXCLUDED.highest_degree,
      matched_companies = EXCLUDED.matched_companies,
      company_tags      = EXCLUDED.company_tags,
      updated_at        = NOW();
    `,
    [
      row.user_id,
      row.name,
      row.gender,
      row.birthdate,
      row.aim_salary,
      row.applied_at,
      row.latest_company,
      row.latest_title,
      row.full_text,
      row.matched_skills,
      row.highest_degree,
      row.matched_companies,
      row.company_tags,
    ]
  );
}

// ── 主流程 ───────────────────────────────────────────────────────
async function main() {
  try {
    console.log(`Connecting to PostgreSQL database: ${DB_NAME} @ ${pool.options.host}`);

    await createIndexTable();

    // 加载技能字典
    const skillDict = await loadSkillDictionary();
    console.log(`Loaded ${skillDict.length} skills from skill_dictionary.`);
    skillDict.forEach(s =>
      console.log(`  skill: "${s.skillName}"  terms: ${JSON.stringify(s.terms)}`)
    );

    // 加载公司字典
    const companyDict = await loadCompanyDictionary();
    console.log(`\nLoaded ${companyDict.length} companies from company_dictionary.`);
    companyDict.forEach(c =>
      console.log(`  company: "${c.companyName}"  terms: ${JSON.stringify(c.terms)}  tags: ${JSON.stringify(c.tags)}`)
    );

    // 读取所有候选人简历
    const result = await pool.query(`
      SELECT 
        user_id, name, gender, birthdate,
        aim_salary, personal, applied_at,
        experience_if, education
      FROM candidate_resumes
      ORDER BY user_id
    `);
    console.log(`\nLoaded ${result.rowCount} resumes from candidate_resumes.`);

    let count         = 0;
    let skillHitCount   = 0;
    let companyHitCount = 0;

    for (const resume of result.rows) {
      const experiences     = safeParseExperience(resume.experience_if);
      const educations      = safeParseEducation(resume.education);
      const fullText        = buildFullText(resume, experiences, educations);
      const matchedSkills   = findMatchedSkills(fullText, skillDict);
      const { matchedCompanies, companyTags } = findMatchedCompanies(fullText, companyDict);
      const latest          = getLatestExperience(experiences);
      const highestDegree   = extractHighestDegree(educations);

      if (matchedSkills.length   > 0) skillHitCount++;
      if (matchedCompanies.length > 0) companyHitCount++;

      await upsertCandidateIndex({
        user_id:           resume.user_id,
        name:              resume.name,
        gender:            resume.gender,
        birthdate:         resume.birthdate,
        aim_salary:        resume.aim_salary,
        applied_at:        resume.applied_at,
        latest_company:    latest ? latest.company : null,
        latest_title:      latest ? latest.title   : null,
        full_text:         fullText,
        matched_skills:    matchedSkills,
        highest_degree:    highestDegree,
        matched_companies: matchedCompanies,
        company_tags:      companyTags,
      });

      count++;
      if (count % 50 === 0) {
        console.log(`  Indexed ${count}/${result.rowCount} ...`);
      }
    }

    console.log(`\nDone. Indexed ${count} resumes.`);
    console.log(`Resumes with at least one matched skill   : ${skillHitCount} / ${count}`);
    console.log(`Resumes with at least one matched company : ${companyHitCount} / ${count}`);

    // ── 验证：Spring Boot 召回 ────────────────────────────────────
    const sbResult = await pool.query(`
      SELECT COUNT(*) AS cnt
      FROM candidate_search_index
      WHERE matched_skills && ARRAY['Spring Boot']::text[];
    `);
    console.log(`\n[Verification] matched_skills 'Spring Boot'  : ${sbResult.rows[0].cnt} records`);

    // ── 验证：Java 召回 ───────────────────────────────────────────
    const javaResult = await pool.query(`
      SELECT COUNT(*) AS cnt
      FROM candidate_search_index
      WHERE matched_skills && ARRAY['Java']::text[];
    `);
    console.log(`[Verification] matched_skills 'Java'         : ${javaResult.rows[0].cnt} records`);

    // ── 验证：国内大厂召回 ────────────────────────────────────────
    const companyTagResult = await pool.query(`
      SELECT COUNT(*) AS cnt
      FROM candidate_search_index
      WHERE company_tags && ARRAY['国内大厂']::text[];
    `);
    console.log(`[Verification] company_tags  '国内大厂'      : ${companyTagResult.rows[0].cnt} records`);

    // ── 验证：公司命中分布 ────────────────────────────────────────
    const companyDistResult = await pool.query(`
      SELECT
        matched_companies,
        company_tags,
        COUNT(*) AS candidate_count
      FROM candidate_search_index
      WHERE company_tags && ARRAY['国内大厂']::text[]
      GROUP BY matched_companies, company_tags
      ORDER BY candidate_count DESC
      LIMIT 10;
    `);
    console.log(`\n[Verification] 国内大厂 company distribution (top 10):`);
    companyDistResult.rows.forEach(r =>
      console.log(`  companies: ${JSON.stringify(r.matched_companies)}  tags: ${JSON.stringify(r.company_tags)}  count: ${r.candidate_count}`)
    );

    // ── 验证：highest_degree 分布 ─────────────────────────────────
    const degreeResult = await pool.query(`
      SELECT highest_degree, COUNT(*) AS cnt
      FROM candidate_search_index
      GROUP BY highest_degree
      ORDER BY cnt DESC;
    `);
    console.log('\n[Verification] highest_degree distribution:');
    degreeResult.rows.forEach(r =>
      console.log(`  ${r.highest_degree ?? 'NULL'}: ${r.cnt}`)
    );

    // ── 验证：总记录数 ────────────────────────────────────────────
    const totalResult = await pool.query(`
      SELECT COUNT(*) AS cnt FROM candidate_search_index;
    `);
    console.log(`\n[Verification] Total records in candidate_search_index: ${totalResult.rows[0].cnt}`);

  } catch (error) {
    console.error('Failed to build search index:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();