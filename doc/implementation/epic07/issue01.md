# Epic 07：扩展公司标签体系

## Issue 01：加入“世界500强”公司标签并验证扩展能力

### 背景

当前系统已经支持通过 `company_dictionary` 维护公司标签，并能在 `candidate_search_index` 中生成 `matched_companies` 和 `company_tags`。同时，n8n 已经能够基于 `国内大厂` / `互联网大厂` 标签进行查询，并支持技能与公司标签组合检索。

本 Issue 对应 MVP 计划中的：

- Step 10：加入“世界500强”公司标签

该阶段的目标是在不修改主查询结构的前提下，扩展一个新的公司标签：`世界500强`，验证公司标签机制是否具备低成本扩展能力。

---

### 目标

扩展 `company_dictionary`，加入或更新一批带有 `世界500强` 标签的公司，并重建候选人索引，使系统能够通过 `company_tags` 查询命中 `世界500强` 的候选人。

重点验证：

1. 新标签只需要维护字典数据和少量 n8n 规则。
2. 不需要修改 `candidate_search_index` 主表结构。
3. 不需要修改公司标签查询 SQL 的主体结构。
4. 重建索引后可以查询到 `company_tags` 包含 `世界500强` 的候选人。
5. 已有 `国内大厂`、`Spring Boot`、`Java` 查询能力不被破坏。

---

### 范围

#### 包含

- 更新 `seed_dictionaries.js` 中的 `company_dictionary` 种子数据。
- 增加或更新带有 `世界500强` 标签的公司。
- 重建 `candidate_search_index`。
- 手工 SQL 验证 `世界500强` 标签召回。
- 在 n8n Code 节点中增加最小规则识别 `世界500强`。
- 使用现有公司标签查询 SQL 验证 Webhook 查询。
- 回归验证 `国内大厂` 标签查询仍可用。

#### 不包含

- 不维护完整世界 500 强公司清单。
- 不做实时榜单校验。
- 不处理公司历史名称、法人主体、集团子公司等复杂映射。
- 不处理“外企”“上市公司”等更多标签扩展。
- 不引入 LLM 判断公司是否属于世界 500 强。
- 不让 LLM 生成 SQL。
- 不返回完整简历。
- 不处理详情查询。

---

### 前置条件

- Epic 05 / Issue 01 已完成：`company_dictionary` 已创建。
- Epic 05 / Issue 02 已完成：n8n 能基于公司标签查询候选人。
- Epic 06 / Issue 01 已完成：技能与公司标签组合查询已验证。
- `candidate_search_index` 中存在：
  - `matched_companies`
  - `company_tags`
- `company_tags` 类型为 `TEXT[]`。
- `seed_dictionaries.js` 和 `build_search_index.js` 可正常执行。

---

### 字典数据更新

需要在 `company_dictionary` 中增加或更新以下公司：

```sql
INSERT INTO company_dictionary
(company_name, aliases, tags)
VALUES
('华为', ARRAY['Huawei'], ARRAY['国内大厂', 'ICT', '制造业', '世界500强']),
('微软中国', ARRAY['Microsoft', '微软'], ARRAY['外企', '世界500强', '软件']),
('Amazon', ARRAY['亚马逊', 'AWS'], ARRAY['外企', '世界500强', '云计算', '互联网大厂']),
('IBM', ARRAY[]::text[], ARRAY['外企', '世界500强', '企业服务']),
('Oracle', ARRAY['甲骨文'], ARRAY['外企', '世界500强', '数据库']),
('SAP', ARRAY[]::text[], ARRAY['外企', '世界500强', '企业软件']),
('Siemens', ARRAY['西门子'], ARRAY['外企', '世界500强', '制造业', '工业软件']),
('Bosch', ARRAY['博世'], ARRAY['外企', '世界500强', '制造业'])
ON CONFLICT (company_name) DO UPDATE SET
  aliases = EXCLUDED.aliases,
  tags = EXCLUDED.tags,
  updated_at = NOW();
```

注意：

- `华为` 已在前序国内大厂数据中存在，本次需要更新其标签，保留 `国内大厂` 并增加 `世界500强`。
- 本阶段只使用这批测试数据，不追求完整覆盖全部世界 500 强企业。
- 标签应来自字典，不应由 n8n 或 LLM 临时推断。

---

### 实施步骤

#### 1. 更新 `seed_dictionaries.js`

在现有公司字典初始化逻辑中增加或更新 `世界500强` 公司数据。

要求：

- 保留已有 `skill_dictionary` 初始化逻辑。
- 保留已有 `company_dictionary` 国内大厂数据。
- 增加本 Issue 中的 `世界500强` 公司数据。
- 使用 `ON CONFLICT (company_name) DO UPDATE`，保证脚本可重复执行。
- 对 `华为` 执行更新时，应确保其 `tags` 包含：
  - `国内大厂`
  - `ICT`
  - `制造业`
  - `世界500强`

执行：

```bash
node seed_dictionaries.js
```

---

#### 2. 验证公司字典中的 `世界500强` 标签

执行 SQL：

```sql
SELECT company_name, aliases, tags
FROM company_dictionary
WHERE tags && ARRAY['世界500强']::text[]
ORDER BY company_name;
```

预期：

- 能看到 `华为`、`微软中国`、`Amazon`、`IBM`、`Oracle`、`SAP`、`Siemens`、`Bosch` 等公司。
- 每条返回记录的 `tags` 包含 `世界500强`。

---

#### 3. 重建候选人索引

执行：

```bash
node seed_dictionaries.js
node build_search_index.js
```

预期：

- 脚本执行成功。
- `candidate_search_index` 被重建或更新。
- `matched_companies` 和 `company_tags` 正常生成。

---

#### 4. 手工验证 `世界500强` 召回

执行 SQL：

```sql
SELECT
  user_id,
  name,
  latest_company,
  latest_title,
  matched_companies,
  company_tags
FROM candidate_search_index
WHERE company_tags && ARRAY['世界500强']::text[]
LIMIT 10;
```

预期：

- 能返回命中 `世界500强` 的候选人。
- `company_tags` 包含 `世界500强`。
- `matched_companies` 中能看到本 Issue 新增或更新的公司之一。

---

#### 5. 回归验证 `国内大厂` 标签仍可用

执行 SQL：

```sql
SELECT
  user_id,
  name,
  matched_companies,
  company_tags
FROM candidate_search_index
WHERE company_tags && ARRAY['国内大厂']::text[]
LIMIT 10;
```

预期：

- 仍能返回国内大厂候选人。
- `华为` 如果命中，应同时可能包含 `国内大厂` 和 `世界500强`。

---

#### 6. 回归验证技能索引仍可用

执行 SQL：

```sql
SELECT
  user_id,
  name,
  latest_company,
  latest_title,
  matched_skills
FROM candidate_search_index
WHERE matched_skills && ARRAY['Spring Boot']::text[]
LIMIT 10;
```

再执行：

```sql
SELECT
  user_id,
  name,
  latest_company,
  latest_title,
  matched_skills
FROM candidate_search_index
WHERE matched_skills && ARRAY['Java']::text[]
LIMIT 10;
```

预期：

- `Spring Boot` 和 `Java` 技能召回仍然可用。

---

### n8n 规则扩展

在已有公司标签查询工作流或组合查询工作流的 Code 节点中增加规则。

#### 公司标签解析规则

```javascript
if (
  question.includes('世界500强') ||
  question.includes('世界 500 强') ||
  question.toLowerCase().includes('fortune 500')
) {
  companyTags.push('世界500强');
}
```

如果该 Code 节点中已经存在：

```javascript
if (question.includes('国内大厂') || question.includes('互联网大厂')) {
  companyTags.push('国内大厂', '互联网大厂');
}
```

则保留原规则，并追加 `世界500强` 规则。

---

### n8n 查询 SQL

可以继续复用已有公司标签查询 SQL：

```sql
SELECT
  user_id,
  name,
  gender,
  birthdate,
  aim_salary,
  applied_at,
  latest_company,
  latest_title,
  matched_companies,
  company_tags
FROM candidate_search_index
WHERE company_tags && $1::text[]
ORDER BY applied_at DESC
LIMIT $2;
```

参数示例：

```json
[
  ["世界500强"],
  10
]
```

说明：

- 主查询结构无需修改。
- 只需要传入新的 `company_tags` 参数。
- 不要拼接用户输入。

---

### n8n 验收测试

#### 测试用例 1：世界500强中文写法

请求：

```json
{
  "question": "优先考虑有世界500强企业工作经验的候选人"
}
```

预期：

- `must_company_tags` 包含 `世界500强`。
- 返回候选人的 `company_tags` 包含 `世界500强`。
- 返回结果包含 `matched_companies`。

---

#### 测试用例 2：带空格中文写法

请求：

```json
{
  "question": "找有世界 500 强经验的候选人"
}
```

预期：

- `must_company_tags` 包含 `世界500强`。
- 能返回命中候选人。

---

#### 测试用例 3：英文写法

请求：

```json
{
  "question": "找有 Fortune 500 公司经验的候选人"
}
```

预期：

- `must_company_tags` 包含 `世界500强`。
- 能返回命中候选人。

---

#### 测试用例 4：国内大厂回归

请求：

```json
{
  "question": "找有国内大厂工作经验的候选人"
}
```

预期：

- `must_company_tags` 仍包含 `国内大厂` 和 `互联网大厂`。
- 能返回国内大厂候选人。

---

### 验收标准

该 Issue 完成时，应满足以下条件：

- `seed_dictionaries.js` 已加入 `世界500强` 公司标签数据。
- `node seed_dictionaries.js` 可重复执行且无报错。
- `company_dictionary` 中能查询到 `tags` 包含 `世界500强` 的公司。
- `node build_search_index.js` 执行成功。
- `candidate_search_index` 中能查询到 `company_tags` 包含 `世界500强` 的候选人。
- 新标签扩展不需要修改 `candidate_search_index` 主结构。
- 新标签扩展不需要修改公司标签查询 SQL 主体结构。
- n8n Code 节点能识别 `世界500强`。
- n8n Code 节点能识别 `世界 500 强`。
- n8n Code 节点能识别 `fortune 500`。
- Webhook 能返回命中 `世界500强` 的候选人。
- `国内大厂` 查询回归正常。
- `Spring Boot` 和 `Java` 技能召回回归正常。
- 全流程不调用 LLM。
- 返回结果不包含 `full_text`、`experience_if`、`personal`。

---

### 测试记录模板

执行完成后，可在本 Issue 下方补充测试记录：

```text
执行日期：
执行人：

1. node seed_dictionaries.js 执行结果：
2. 世界500强公司字典记录数：
3. node build_search_index.js 执行结果：
4. 命中 世界500强 的候选人数：
5. matched_companies 抽样结果：
6. company_tags 抽样结果：
7. n8n 世界500强测试结果：
8. n8n 世界 500 强测试结果：
9. n8n Fortune 500 测试结果：
10. 国内大厂回归测试结果：
11. Spring Boot 回归测试结果：
12. Java 回归测试结果：
13. 是否调用 LLM：
14. 遗留问题：
```

---

### 风险与注意事项

- 本阶段不维护完整世界 500 强名单，只验证标签扩展机制。
- 公司是否属于世界 500 强应以当前项目测试字典为准；如用于真实业务，应定期与权威最新名单交叉校验。
- `华为` 等公司可能同时具备多个标签，索引构建时必须合并并去重。
- 不要让 LLM 判断公司标签，避免不可控和不可复现。
- 不要为了扩展新标签而修改主查询结构，否则说明标签机制抽象不足。
- 返回字段继续保持克制，不返回完整简历或大段原文。

---

### 下一步

通过本 Issue 后，再进入下一个 Epic：加入最终 LLM 回答生成，但只允许 LLM 基于压缩后的候选人结果进行中文总结。