# Epic 05：公司字典与公司标签基础

## 状态
已完成

## Issue 03：索引数据质量验证脚本

### 背景

Epic 05 / Issue 01 和 Issue 02 已完成公司字典创建、索引构建和 n8n 公司标签查询接入。在进入下一个 Epic 之前，需要对当前索引数据的质量进行系统性验证，确保查询体系返回的候选人与原始简历数据一致。

本 Issue 对应 MVP 计划中的质量保障环节：

- 验证公司标签索引的精准率：查出来的候选人，原始简历是否真的提到了对应公司。
- 验证公司标签索引的召回率：原始简历中有对应公司的候选人，是否都被索引命中。
- 验证技能索引的精准率：查出来的候选人，原始简历是否真的包含对应技能关键词。
- 验证索引字段完整性：`matched_companies`、`company_tags`、`matched_skills` 是否存在空值异常。

该阶段不修改任何业务逻辑，只做数据验证和报告输出。

---

### 目标

创建独立验证脚本 `scripts/validate/validate_index_quality.js`，使其能够：

1. 验证公司标签精准率（Precision）。
2. 验证公司标签召回率（Recall）。
3. 验证技能索引精准率（Precision）。
4. 验证索引字段完整性。
5. 输出可读的验证报告到控制台。
6. 输出详细的可疑记录到 `scripts/validate/report_output/` 目录。

---

### 范围

#### 包含

- 创建 `scripts/validate/validate_index_quality.js`。
- 创建 `scripts/validate/report_output/` 目录（脚本自动创建）。
- 公司标签精准率验证。
- 公司标签召回率验证。
- 技能索引精准率验证（以 `Java` 和 `Spring Boot` 为代表）。
- 索引字段完整性检查。
- 控制台输出汇总报告。
- 输出可疑记录 JSON 文件供人工审查。

#### 不包含

- 不修改 `seed_dictionaries.js`。
- 不修改 `build_search_index.js`。
- 不修改任何索引构建逻辑。
- 不修改任何 n8n 工作流。
- 不调用 LLM。
- 不自动修复数据问题。
- 不做性能基准测试。

---

### 前置条件

- Epic 05 / Issue 01 已完成：`company_dictionary` 已创建并填充数据。
- Epic 05 / Issue 02 已完成：n8n 公司标签查询已验证可用。
- `candidate_search_index` 中存在 `matched_companies` 和 `company_tags` 字段。
- `candidate_search_index` 中存在 `matched_skills` 字段。
- `candidate_resumes` 表中存在 `full_text` 或等效原始文本字段。
- 项目已配置数据库连接（`DATABASE_URL` 或等效环境变量）。

---

### 脚本结构

```text
scripts/
  validate/
    validate_index_quality.js    ← 主验证脚本
    report_output/               ← 自动创建，存放输出报告
      company_tag_precision_suspicious.json
      company_tag_recall_missing.json
      skill_precision_suspicious.json
      index_field_integrity.json
```

---

### 验证模块设计

#### 模块 1：公司标签精准率验证

**目标**：索引中命中了公司标签的候选人，原始简历是否真的提到了对应公司。

**逻辑**：

1. 从 `candidate_search_index` 查出 `company_tags` 包含 `国内大厂` 或 `互联网大厂` 的候选人。
2. 回到 `candidate_resumes` 查询这些候选人的原始文本。
3. 检查原始文本中是否包含任意一家国内大厂公司的名称或别名。
4. 统计精准率，列出可疑记录。

**输出指标**：

```text
[公司标签精准率]
  索引命中候选人数：N
  原始简历确认正确：N
  精准率：XX.XX%
  可疑记录数：N
  → 可疑记录已输出至 report_output/company_tag_precision_suspicious.json
```

---

#### 模块 2：公司标签召回率验证

**目标**：原始简历中明确提到了国内大厂公司名称的候选人，是否都被索引命中。

**逻辑**：

1. 从 `candidate_resumes` 中找出原始文本包含任意大厂公司名或别名的候选人。
2. 检查这些候选人在 `candidate_search_index` 中的 `company_tags` 是否包含 `国内大厂`。
3. 统计召回率，列出漏召回记录。

**输出指标**：

```text
[公司标签召回率]
  原始简历中有大厂关键词的候选人数：N
  索引中已命中的候选人数：N
  召回率：XX.XX%
  漏召回候选人数：N
  → 漏召回记录已输出至 report_output/company_tag_recall_missing.json
```

---

#### 模块 3：技能索引精准率验证

**目标**：索引中命中了 `Java` 或 `Spring Boot` 技能的候选人，原始简历是否真的包含对应关键词。

**逻辑**：

1. 从 `candidate_search_index` 查出 `matched_skills` 包含 `Java` 的候选人。
2. 回到 `candidate_resumes` 检查原始文本是否包含 `Java`（大小写不敏感）。
3. 对 `Spring Boot` 重复上述步骤。
4. 统计精准率，列出可疑记录。

**输出指标**：

```text
[技能索引精准率 - Java]
  索引命中候选人数：N
  原始简历确认正确：N
  精准率：XX.XX%
  可疑记录数：N

[技能索引精准率 - Spring Boot]
  索引命中候选人数：N
  原始简历确认正确：N
  精准率：XX.XX%
  可疑记录数：N

  → 可疑记录已输出至 report_output/skill_precision_suspicious.json
```

---

#### 模块 4：索引字段完整性检查

**目标**：检查索引表中是否存在字段异常，例如 NULL 值、空数组、空字符串等。

**逻辑**：

1. 统计 `matched_companies` 为空数组或 NULL 的候选人数。
2. 统计 `company_tags` 为空数组或 NULL 的候选人数。
3. 统计 `matched_skills` 为空数组或 NULL 的候选人数。
4. 统计 `latest_company` 为空或 NULL 的候选人数。
5. 统计 `latest_title` 为空或 NULL 的候选人数。
6. 输出各字段覆盖率。

**输出指标**：

```text
[索引字段完整性]
  总候选人数：N
  matched_companies 有值：N（XX.XX%）
  company_tags 有值：N（XX.XX%）
  matched_skills 有值：N（XX.XX%）
  latest_company 有值：N（XX.XX%）
  latest_title 有值：N（XX.XX%）
  → 详细记录已输出至 report_output/index_field_integrity.json
```

---

### 实施步骤

#### 1. 创建脚本目录

```bash
mkdir -p scripts/validate/report_output
```

---

#### 2. 创建主验证脚本

文件路径：

```text
scripts/validate/validate_index_quality.js
```

脚本结构示例：

```javascript
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const OUTPUT_DIR = path.join(__dirname, 'report_output');
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// 国内大厂关键词列表（与 company_dictionary 保持一致）
const BIG_TECH_KEYWORDS = [
  '阿里巴巴', '阿里', 'Alibaba',
  '腾讯', 'Tencent',
  '百度', 'Baidu',
  '字节跳动', 'ByteDance', '抖音',
  '美团', 'Meituan',
  '京东', 'JD',
  '华为', 'Huawei'
];

async function validateCompanyTagPrecision() { /* ... */ }
async function validateCompanyTagRecall() { /* ... */ }
async function validateSkillPrecision(skill) { /* ... */ }
async function validateFieldIntegrity() { /* ... */ }

async function main() {
  console.log('========================================');
  console.log('  索引数据质量验证报告');
  console.log(`  执行时间：${new Date().toISOString()}`);
  console.log('========================================\n');

  await validateCompanyTagPrecision();
  await validateCompanyTagRecall();
  await validateSkillPrecision('Java');
  await validateSkillPrecision('Spring Boot');
  await validateFieldIntegrity();

  console.log('\n========================================');
  console.log('  验证完成');
  console.log('========================================');

  await pool.end();
}

main().catch(err => {
  console.error('验证脚本执行失败：', err);
  process.exit(1);
});
```

---

#### 3. 执行脚本

```bash
node scripts/validate/validate_index_quality.js
```

预期输出示例：

```text
========================================
  索引数据质量验证报告
  执行时间：2026-07-17T10:00:00.000Z
========================================

[公司标签精准率]
  索引命中候选人数：42
  原始简历确认正确：40
  精准率：95.24%
  可疑记录数：2
  → 可疑记录已输出至 report_output/company_tag_precision_suspicious.json

[公司标签召回率]
  原始简历中有大厂关键词的候选人数：45
  索引中已命中的候选人数：42
  召回率：93.33%
  漏召回候选人数：3
  → 漏召回记录已输出至 report_output/company_tag_recall_missing.json

[技能索引精准率 - Java]
  索引命中候选人数：88
  原始简历确认正确：87
  精准率：98.86%
  可疑记录数：1

[技能索引精准率 - Spring Boot]
  索引命中候选人数：35
  原始简历确认正确：35
  精准率：100.00%
  可疑记录数：0

  → 可疑记录已输出至 report_output/skill_precision_suspicious.json

[索引字段完整性]
  总候选人数：200
  matched_companies 有值：42（21.00%）
  company_tags 有值：42（21.00%）
  matched_skills 有值：195（97.50%）
  latest_company 有值：198（99.00%）
  latest_title 有值：197（98.50%）
  → 详细记录已输出至 report_output/index_field_integrity.json

========================================
  验证完成
========================================
```

---

#### 4. 人工审查可疑记录

打开 `report_output/company_tag_precision_suspicious.json`，人工确认：

- 是否为误召回（索引错误命中）。
- 还是原始文本中有该公司但关键词写法不同（别名覆盖不足）。

打开 `report_output/company_tag_recall_missing.json`，人工确认：

- 漏召回的候选人原始简历中，公司名称的写法是什么。
- 是否需要补充 `company_dictionary` 的别名。

---

### 验收标准

该 Issue 完成时，应满足以下条件：

- `scripts/validate/validate_index_quality.js` 脚本存在且可执行。
- 脚本执行不报错，能连接数据库并输出报告。
- 控制台能输出公司标签精准率指标。
- 控制台能输出公司标签召回率指标。
- 控制台能输出 `Java` 和 `Spring Boot` 技能精准率指标。
- 控制台能输出索引字段完整性指标。
- `report_output/` 目录下能生成可疑记录 JSON 文件。
- 脚本可重复执行，每次覆盖上一次的报告文件。
- 脚本不修改任何数据库数据。
- 脚本不调用 LLM。

---

### 关键验证 SQL 参考

以下 SQL 可在脚本开发前手工验证数据库连通性和字段可用性：

```sql
-- 公司标签精准率：索引命中候选人数
SELECT COUNT(*)
FROM candidate_search_index
WHERE company_tags && ARRAY['国内大厂', '互联网大厂']::text[];
```

```sql
-- 公司标签召回率：原始简历中有大厂关键词的候选人数
SELECT COUNT(DISTINCT cr.user_id)
FROM candidate_resumes cr
WHERE
  cr.full_text ILIKE '%阿里巴巴%' OR cr.full_text ILIKE '%阿里%' OR
  cr.full_text ILIKE '%腾讯%'     OR cr.full_text ILIKE '%字节跳动%' OR
  cr.full_text ILIKE '%百度%'     OR cr.full_text ILIKE '%美团%' OR
  cr.full_text ILIKE '%京东%'     OR cr.full_text ILIKE '%华为%';
```

```sql
-- 索引字段完整性：各字段覆盖率
SELECT
  COUNT(*)                                                        AS total,
  SUM(CASE WHEN array_length(matched_companies, 1) > 0 THEN 1 ELSE 0 END) AS has_matched_companies,
  SUM(CASE WHEN array_length(company_tags, 1) > 0 THEN 1 ELSE 0 END)      AS has_company_tags,
  SUM(CASE WHEN array_length(matched_skills, 1) > 0 THEN 1 ELSE 0 END)    AS has_matched_skills,
  SUM(CASE WHEN latest_company IS NOT NULL AND latest_company <> '' THEN 1 ELSE 0 END) AS has_latest_company
FROM candidate_search_index;
```

---

### 测试记录模板

执行完成后，可在本 Issue 下方补充测试记录：

```text
执行日期：
执行人：

1. 脚本执行结果（成功/失败）：
2. 公司标签精准率：
3. 公司标签召回率：
4. Java 技能精准率：
5. Spring Boot 技能精准率：
6. matched_companies 覆盖率：
7. matched_skills 覆盖率：
8. 可疑记录数（公司标签）：
9. 漏召回记录数（公司标签）：
10. 人工审查可疑记录结论：
11. 是否需要补充 company_dictionary 别名：
12. 是否需要重建索引：
13. 遗留问题：
```

---

### 风险与注意事项

- 脚本只读，不修改任何数据，可以安全地重复执行。
- `full_text` 中的公司名称写法可能与字典不一致，例如"阿里"和"阿里巴巴"是不同字符串，需要在关键词列表中都覆盖。
- 召回率验证依赖 `full_text` 字段的质量，如果 `full_text` 本身不完整，召回率数字会偏低。
- 精准率偏低时，优先检查 `company_dictionary` 中的别名是否过于通用，例如单字别名容易误命中。
- 报告文件每次执行会覆盖，如需保留历史报告，可在文件名中加入时间戳。

---

### 下一步

通过本 Issue 后，根据验证报告的结论决定：

- 如果精准率或召回率明显偏低，先补充 `company_dictionary` 别名并重建索引，再进入下一个 Epic。
- 如果指标正常，直接进入下一个 Epic：组合技能条件和公司标签条件，支持 `Spring Boot` + `国内大厂` 的第一个业务价值查询。