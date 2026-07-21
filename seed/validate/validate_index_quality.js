'use strict';

/**
 * 索引数据质量验证脚本
 *
 * 用法：
 *   node seed/validate/validate_index_quality.js
 *
 * 验证模块：
 *   1. 公司标签精准率  —— 索引命中的候选人，原始简历是否真的提到了大厂
 *   2. 公司标签召回率  —— 原始简历有大厂关键词的候选人，是否都被索引命中
 *   3. 技能索引精准率  —— 索引命中的候选人，原始简历是否真的包含对应技能关键词
 *   4. 索引字段完整性  —— 各关键字段的覆盖率和空值情况
 *
 * 输出：
 *   - 控制台汇总报告
 *   - seed/validate/report_output/*.json  可疑 / 漏召回记录
 */

const { Pool } = require('../test_data/node_modules/pg');
const fs   = require('fs');
const path = require('path');

// ── 数据库连接（与 build_search_index.js 保持一致）─────────────────
const DB_NAME = process.env.PGDATABASE || 'resume';

const pool = new Pool({
  host:     process.env.PGHOST        || '192.168.123.171',
  port:     Number(process.env.PGPORT || 5432),
  database: DB_NAME,
  user:     process.env.PGUSER        || 'postgres',
  password: process.env.PGPASSWORD    || 'postgres',
});

// ── 报告输出目录 ───────────────────────────────────────────────────
const OUTPUT_DIR = path.join(__dirname, 'report_output');
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// ── 大厂关键词在运行时从 company_dictionary 动态加载 ───────────────
//    loadBigTechKeywords() 会在 main() 中调用，结果存入此变量
//    覆盖所有被打上 "国内大厂" 或 "互联网大厂" 标签的公司名称和别名
let BIG_TECH_KEYWORDS = [];

async function loadBigTechKeywords() {
  const result = await pool.query(`
    SELECT company_name, aliases
    FROM company_dictionary
    WHERE tags && ARRAY['国内大厂', '互联网大厂']::text[]
  `);
  const keywords = [];
  for (const row of result.rows) {
    keywords.push(row.company_name);
    (row.aliases || []).forEach(a => keywords.push(a));
  }
  BIG_TECH_KEYWORDS = [...new Set(keywords.filter(Boolean))];
  console.log(`  已从 company_dictionary 加载 ${result.rowCount} 家大厂，共 ${BIG_TECH_KEYWORDS.length} 个关键词`);
  console.log(`  关键词列表：${BIG_TECH_KEYWORDS.join(', ')}`);
}

// ── 工具函数 ───────────────────────────────────────────────────────

/**
 * 检查文本是否包含关键词列表中的任意一个（大小写不敏感）
 */
function containsAnyKeyword(text, keywords) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return keywords.some(kw => lower.includes(kw.toLowerCase()));
}

/**
 * 找出文本中命中的关键词列表
 */
function findMatchedKeywords(text, keywords) {
  if (!text) return [];
  const lower = text.toLowerCase();
  return keywords.filter(kw => lower.includes(kw.toLowerCase()));
}

/**
 * 将 experience_if JSON 字符串解析为数组
 */
function safeParseExperience(experienceIf) {
  try {
    const parsed = JSON.parse(experienceIf);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * 从 experience_if 中提取纯文本（公司名 + 职位 + 摘要）
 * 用于召回率验证时对原始简历做关键词扫描
 */
function extractExperienceText(experienceIf) {
  const exps = safeParseExperience(experienceIf);
  return exps
    .flatMap(exp => [exp.company, exp.title, exp.summary])
    .filter(Boolean)
    .join('\n');
}

/**
 * 写入 JSON 报告文件
 */
function writeReport(filename, data) {
  const filepath = path.join(OUTPUT_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf8');
  return filepath;
}

/**
 * 格式化百分比
 */
function pct(numerator, denominator) {
  if (denominator === 0) return 'N/A';
  return ((numerator / denominator) * 100).toFixed(2) + '%';
}

// ── 模块 1：公司标签精准率验证 ─────────────────────────────────────
//
//   问题：索引认为这个候选人有大厂经历，原始简历真的提到了大厂吗？
//
//   做法：
//     1. 从 candidate_search_index 取出 company_tags 命中大厂的候选人
//     2. 回到 candidate_resumes 取 experience_if（原始工作经历 JSON）
//     3. 把 experience_if 解析后拼成文本，检查是否包含大厂关键词
//     4. 不包含 → 可疑记录（可能是别名误命中）
//
async function validateCompanyTagPrecision() {
  console.log('\n----------------------------------------');
  console.log('[模块 1] 公司标签精准率验证');
  console.log('----------------------------------------');

  // 取索引中命中大厂标签的候选人（含 matched_companies 用于报告）
  const indexedResult = await pool.query(`
    SELECT
      csi.user_id,
      csi.name,
      csi.matched_companies,
      csi.company_tags,
      cr.experience_if
    FROM candidate_search_index csi
    LEFT JOIN candidate_resumes cr ON csi.user_id = cr.user_id
    WHERE csi.company_tags && ARRAY['国内大厂', '互联网大厂']::text[]
    ORDER BY csi.user_id
  `);

  const total      = indexedResult.rowCount;
  const suspicious = [];

  for (const row of indexedResult.rows) {
    // 用原始 experience_if 文本做反查
    const expText = extractExperienceText(row.experience_if);
    const hasKeyword = containsAnyKeyword(expText, BIG_TECH_KEYWORDS);

    if (!hasKeyword) {
      // 可疑：索引命中了大厂标签，但原始工作经历文本中找不到任何大厂关键词
      suspicious.push({
        user_id:           row.user_id,
        name:              row.name,
        matched_companies: row.matched_companies,
        company_tags:      row.company_tags,
        experience_text_preview: expText.slice(0, 200),
        issue: '索引命中大厂标签，但原始 experience_if 中未找到大厂关键词',
      });
    }
  }

  const confirmed = total - suspicious.length;

  console.log(`  索引命中候选人数：${total}`);
  console.log(`  原始简历确认正确：${confirmed}`);
  console.log(`  精准率：${pct(confirmed, total)}`);
  console.log(`  可疑记录数：${suspicious.length}`);

  if (suspicious.length > 0) {
    const reportPath = writeReport('company_tag_precision_suspicious.json', suspicious);
    console.log(`  → 可疑记录已输出至 ${reportPath}`);
  } else {
    console.log('  → 无可疑记录');
  }

  return { total, confirmed, suspicious: suspicious.length };
}

// ── 模块 2：公司标签召回率验证 ─────────────────────────────────────
//
//   问题：原始简历里明确写了大厂名字，索引有没有命中？
//
//   做法：
//     1. 从 candidate_resumes 取所有候选人的 experience_if
//     2. 解析后检查是否包含大厂关键词
//     3. 包含 → 这个候选人"应该"被索引命中
//     4. 检查 candidate_search_index 中该候选人的 company_tags 是否包含 '国内大厂'
//     5. 不包含 → 漏召回记录
//
async function validateCompanyTagRecall() {
  console.log('\n----------------------------------------');
  console.log('[模块 2] 公司标签召回率验证');
  console.log('----------------------------------------');

  // 取所有候选人的原始简历（只需 experience_if 做关键词扫描）
  const resumesResult = await pool.query(`
    SELECT
      cr.user_id,
      cr.name,
      cr.experience_if,
      csi.company_tags
    FROM candidate_resumes cr
    LEFT JOIN candidate_search_index csi ON cr.user_id = csi.user_id
    ORDER BY cr.user_id
  `);

  let rawHasKeyword = 0;   // 原始简历中有大厂关键词的候选人数
  let indexHit      = 0;   // 其中被索引命中的
  const missing     = [];  // 漏召回记录

  for (const row of resumesResult.rows) {
    const expText    = extractExperienceText(row.experience_if);
    const hasKeyword = containsAnyKeyword(expText, BIG_TECH_KEYWORDS);

    if (!hasKeyword) continue;

    rawHasKeyword++;

    const companyTags = row.company_tags || [];
    const isHit = companyTags.includes('国内大厂') || companyTags.includes('互联网大厂');

    if (isHit) {
      indexHit++;
    } else {
      // 漏召回：原始简历有大厂关键词，但索引没有命中
      const matchedKeywords = findMatchedKeywords(expText, BIG_TECH_KEYWORDS);
      missing.push({
        user_id:           row.user_id,
        name:              row.name,
        matched_keywords:  matchedKeywords,
        index_company_tags: companyTags,
        experience_text_preview: expText.slice(0, 200),
        issue: '原始 experience_if 中含大厂关键词，但索引 company_tags 未命中',
      });
    }
  }

  console.log(`  原始简历中有大厂关键词的候选人数：${rawHasKeyword}`);
  console.log(`  索引中已命中的候选人数：${indexHit}`);
  console.log(`  召回率：${pct(indexHit, rawHasKeyword)}`);
  console.log(`  漏召回候选人数：${missing.length}`);

  if (missing.length > 0) {
    const reportPath = writeReport('company_tag_recall_missing.json', missing);
    console.log(`  → 漏召回记录已输出至 ${reportPath}`);
    // 额外提示：列出出现频率最高的漏召回关键词，帮助判断是否需要补充别名
    const kwFreq = {};
    missing.forEach(r => r.matched_keywords.forEach(kw => {
      kwFreq[kw] = (kwFreq[kw] || 0) + 1;
    }));
    const topKw = Object.entries(kwFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([kw, cnt]) => `"${kw}"(${cnt}次)`)
      .join(', ');
    if (topKw) {
      console.log(`  → 漏召回高频关键词：${topKw}`);
    }
  } else {
    console.log('  → 无漏召回记录');
  }

  return { rawHasKeyword, indexHit, missing: missing.length };
}

// ── 模块 3：技能索引精准率验证 ─────────────────────────────────────
//
//   问题：索引认为这个候选人有某技能，原始简历真的有这个关键词吗？
//
//   做法：
//     1. 从 candidate_search_index 取 matched_skills 包含目标技能的候选人
//     2. 回到 candidate_search_index 自身的 full_text 字段做反查
//        （full_text 是由 build_search_index.js 从原始数据拼接而成的）
//     3. full_text 中不包含该技能关键词 → 可疑记录
//
async function validateSkillPrecision(skill) {
  console.log(`\n----------------------------------------`);
  console.log(`[模块 3] 技能索引精准率验证 - ${skill}`);
  console.log('----------------------------------------');

  const result = await pool.query(`
    SELECT
      user_id,
      name,
      matched_skills,
      full_text
    FROM candidate_search_index
    WHERE matched_skills && ARRAY[$1]::text[]
    ORDER BY user_id
  `, [skill]);

  const total      = result.rowCount;
  const suspicious = [];

  for (const row of result.rows) {
    // full_text 本身就是从原始数据拼接来的，直接在上面做大小写不敏感检索
    const hasKeyword = containsAnyKeyword(row.full_text, [skill]);

    if (!hasKeyword) {
      suspicious.push({
        user_id:       row.user_id,
        name:          row.name,
        matched_skills: row.matched_skills,
        full_text_preview: (row.full_text || '').slice(0, 200),
        issue: `索引 matched_skills 包含 "${skill}"，但 full_text 中未找到该关键词`,
      });
    }
  }

  const confirmed = total - suspicious.length;

  console.log(`  索引命中候选人数：${total}`);
  console.log(`  原始简历确认正确：${confirmed}`);
  console.log(`  精准率：${pct(confirmed, total)}`);
  console.log(`  可疑记录数：${suspicious.length}`);

  return { skill, total, confirmed, suspicious: suspicious.length, suspiciousRecords: suspicious };
}

// ── 模块 4：索引字段完整性检查 ─────────────────────────────────────
//
//   检查关键字段是否存在 NULL、空数组、空字符串等异常情况
//   帮助发现索引构建时的遗漏
//
async function validateFieldIntegrity() {
  console.log('\n----------------------------------------');
  console.log('[模块 4] 索引字段完整性检查');
  console.log('----------------------------------------');

  const result = await pool.query(`
    SELECT
      COUNT(*)                                                                    AS total,
      SUM(CASE WHEN array_length(matched_companies, 1) > 0 THEN 1 ELSE 0 END)   AS has_matched_companies,
      SUM(CASE WHEN array_length(company_tags, 1) > 0 THEN 1 ELSE 0 END)        AS has_company_tags,
      SUM(CASE WHEN array_length(matched_skills, 1) > 0 THEN 1 ELSE 0 END)      AS has_matched_skills,
      SUM(CASE WHEN latest_company IS NOT NULL
               AND latest_company <> '' THEN 1 ELSE 0 END)                      AS has_latest_company,
      SUM(CASE WHEN latest_title IS NOT NULL
               AND latest_title <> '' THEN 1 ELSE 0 END)                        AS has_latest_title,
      SUM(CASE WHEN highest_degree IS NOT NULL
               AND highest_degree <> '' THEN 1 ELSE 0 END)                      AS has_highest_degree,
      SUM(CASE WHEN full_text IS NOT NULL
               AND full_text <> '' THEN 1 ELSE 0 END)                           AS has_full_text
    FROM candidate_search_index
  `);

  const r     = result.rows[0];
  const total = Number(r.total);

  const fields = [
    { label: 'matched_companies', value: Number(r.has_matched_companies) },
    { label: 'company_tags',      value: Number(r.has_company_tags) },
    { label: 'matched_skills',    value: Number(r.has_matched_skills) },
    { label: 'latest_company',    value: Number(r.has_latest_company) },
    { label: 'latest_title',      value: Number(r.has_latest_title) },
    { label: 'highest_degree',    value: Number(r.has_highest_degree) },
    { label: 'full_text',         value: Number(r.has_full_text) },
  ];

  console.log(`  总候选人数：${total}`);
  fields.forEach(f => {
    const bar = total > 0
      ? '█'.repeat(Math.round((f.value / total) * 20)).padEnd(20, '░')
      : '░'.repeat(20);
    console.log(`  ${f.label.padEnd(20)} 有值：${String(f.value).padStart(4)} / ${total}  (${pct(f.value, total)})  ${bar}`);
  });

  // 找出 matched_skills 和 matched_companies 同时为空的候选人（可能是索引构建失败）
  const bothEmptyResult = await pool.query(`
    SELECT user_id, name, latest_company, latest_title
    FROM candidate_search_index
    WHERE array_length(matched_skills, 1) IS NULL
      AND array_length(matched_companies, 1) IS NULL
    ORDER BY user_id
    LIMIT 20
  `);

  const integrityReport = {
    total,
    fields: fields.map(f => ({
      field:    f.label,
      has_value: f.value,
      coverage:  pct(f.value, total),
    })),
    both_skills_and_companies_empty_sample: bothEmptyResult.rows,
  };

  const reportPath = writeReport('index_field_integrity.json', integrityReport);
  console.log(`  → 详细记录已输出至 ${reportPath}`);

  if (bothEmptyResult.rowCount > 0) {
    console.log(`  ⚠ 注意：${bothEmptyResult.rowCount} 条记录的 matched_skills 和 matched_companies 同时为空，请检查索引构建是否正常。`);
  }

  return integrityReport;
}

// ── 主流程 ─────────────────────────────────────────────────────────
async function main() {
  console.log('========================================');
  console.log('  索引数据质量验证报告');
  console.log(`  执行时间：${new Date().toISOString()}`);
  console.log(`  数据库：${DB_NAME} @ ${pool.options.host}`);
  console.log('========================================');

  try {
    // 预加载：从 company_dictionary 动态读取大厂关键词
    console.log('\n----------------------------------------');
    console.log('[预加载] 从 company_dictionary 读取大厂关键词');
    console.log('----------------------------------------');
    await loadBigTechKeywords();

    // 模块 1：公司标签精准率
    const precisionResult = await validateCompanyTagPrecision();

    // 模块 2：公司标签召回率
    const recallResult = await validateCompanyTagRecall();

    // 模块 3：技能索引精准率（Java 和 Spring Boot）
    const javaResult       = await validateSkillPrecision('Java');
    const springBootResult = await validateSkillPrecision('Spring Boot');

    // 合并技能可疑记录统一输出
    const skillSuspicious = [
      ...javaResult.suspiciousRecords,
      ...springBootResult.suspiciousRecords,
    ];
    if (skillSuspicious.length > 0) {
      const reportPath = writeReport('skill_precision_suspicious.json', skillSuspicious);
      console.log(`\n  → 技能可疑记录已输出至 ${reportPath}`);
    }

    // 模块 4：字段完整性
    await validateFieldIntegrity();

    // ── 汇总 ────────────────────────────────────────────────────────
    console.log('\n========================================');
    console.log('  验证汇总');
    console.log('========================================');
    console.log(`  公司标签精准率：${pct(precisionResult.confirmed, precisionResult.total)}`);
    console.log(`  公司标签召回率：${pct(recallResult.indexHit, recallResult.rawHasKeyword)}`);
    console.log(`  Java 技能精准率：${pct(javaResult.confirmed, javaResult.total)}`);
    console.log(`  Spring Boot 技能精准率：${pct(springBootResult.confirmed, springBootResult.total)}`);

    // 给出行动建议
    console.log('\n  行动建议：');
    if (precisionResult.suspicious > 0) {
      console.log(`  ⚠ 公司标签有 ${precisionResult.suspicious} 条可疑记录，请检查 company_dictionary 别名是否过于通用。`);
    }
    if (recallResult.missing > 0) {
      console.log(`  ⚠ 公司标签有 ${recallResult.missing} 条漏召回，请检查 company_dictionary 是否缺少别名，并重建索引。`);
    }
    if (javaResult.suspicious > 0 || springBootResult.suspicious > 0) {
      console.log(`  ⚠ 技能索引有可疑记录，请检查 skill_dictionary 的别名匹配逻辑。`);
    }
    if (
      precisionResult.suspicious === 0 &&
      recallResult.missing === 0 &&
      javaResult.suspicious === 0 &&
      springBootResult.suspicious === 0
    ) {
      console.log('  ✓ 所有指标正常，可以进入下一个 Epic。');
    }

    console.log('\n========================================');
    console.log('  验证完成');
    console.log('========================================');

  } catch (err) {
    console.error('\n验证脚本执行失败：', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();