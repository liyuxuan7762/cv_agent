# Epic 02：最小技能字典与技能归一化基础

## Issue 02：构建第一版候选人搜索索引并验证技能召回

### 背景

在 `skill_dictionary` 最小技能字典创建完成后，需要基于原始简历数据构建第一版候选人搜索索引。

本 Issue 对应 MVP 计划中的：

- Step 3：构建第一版归一化索引，只验证技能召回

该阶段只关注最小可用索引能力，不处理复杂公司标签，不接入 LLM，也不做自然语言问答。核心目标是确认能够从候选人简历文本中识别并写入标准技能，并通过 SQL 检索命中技能的候选人。

---

### 目标

创建并构建 `candidate_search_index`，先验证以下字段可用：

- `user_id`
- `name`
- `full_text`
- `matched_skills`
- `latest_company`
- `latest_title`

重点验证：

- 能构建索引数据。
- 能检索到 `matched_skills` 包含 `Spring Boot` 的候选人。
- 能检索到 `matched_skills` 包含 `Java` 的候选人。

---

### 范围

#### 包含

- 使用已有脚本 `build_search_index.js` 构建索引。
- 如脚本尚未完整支持，则补充最小索引构建能力。
- 创建或重建 `candidate_search_index` 表。
- 从 `candidate_resumes` 中读取候选人数据。
- 从 `personal` 和 `experience_if` 等文本中组合 `full_text`。
- 使用 `skill_dictionary.skill_name`、`aliases` 和必要规则匹配技能。
- 写入 `matched_skills`。
- 提取最近一段工作经历中的公司和职位，写入 `latest_company`、`latest_title`。
- 使用 SQL 手工验证技能召回。

#### 不包含

- 不接入 n8n 技能查询。
- 不创建公司字典。
- 不生成 `company_tags`。
- 不处理“国内大厂”。
- 不处理“世界500强”。
- 不做复杂打分。
- 不调用 LLM。
- 不返回完整简历给 AI。

---

### 前置条件

- Epic 01 / Issue 01 已完成：原始简历数据可用。
- Epic 02 / Issue 01 已完成：`skill_dictionary` 已创建并包含 `Java`、`Spring Boot`、`微服务`。
- 项目根目录存在脚本：

```text
build_search_index.js
```

- PostgreSQL 数据库可用。
- `candidate_resumes` 表中已有候选人数据。

---

### 建议索引表结构

第一版 `candidate_search_index` 可以采用以下最小字段结构：

```sql
CREATE TABLE IF NOT EXISTS candidate_search_index (
  user_id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100),
  gender VARCHAR(20),
  birthdate DATE,
  aim_salary VARCHAR(100),
  applied_at TIMESTAMP,
  latest_company VARCHAR(200),
  latest_title VARCHAR(200),
  full_text TEXT,
  matched_skills TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

说明：

- 当前阶段可以先保留 `full_text`，用于调试索引构建。
- n8n 查询阶段不得返回 `full_text`。
- 后续公司字典阶段会扩展 `matched_companies`、`company_tags` 等字段。

---

### 技能匹配规则

第一版技能匹配可以采用简单规则：

1. 读取所有 `skill_dictionary` 记录。
2. 对每条候选人简历构造 `full_text`。
3. 对每个技能，检查以下内容是否出现在 `full_text` 中：
   - `skill_name`
   - `aliases` 中任意别名
4. 如果命中，则将标准技能名写入 `matched_skills`。
5. `matched_skills` 去重后保存为 `TEXT[]`。

示例：

如果候选人文本包含：

```text
熟悉 SpringBoot、Java、微服务架构
```

则 `matched_skills` 应至少包含：

```text
Spring Boot
Java
微服务
```

---

### 最近公司和职位提取规则

第一版可以采用最小规则：

1. 将 `experience_if` 解析为 JSON 数组。
2. 取数组中的第一条或按时间排序后的最近一条工作经历。
3. 提取：
   - `company` → `latest_company`
   - `title` → `latest_title`

如果当前测试数据的 `experience_if` 已按时间倒序排列，则可以直接取第一个元素。

如果无法确认排序规则，本 Issue 中需要记录实际数据结构，并在脚本中采用最稳妥的现有字段判断方式。

---

### 实施步骤

#### 1. 检查现有 `build_search_index.js`

确认脚本是否已经具备以下能力：

- 连接 PostgreSQL。
- 读取 `candidate_resumes`。
- 读取 `skill_dictionary`。
- 创建或清理 `candidate_search_index`。
- 构建 `full_text`。
- 匹配技能。
- 写入 `matched_skills`。
- 写入 `latest_company` 和 `latest_title`。

如果缺少能力，只补齐本 Issue 范围内的最小实现。

---

#### 2. 执行字典初始化脚本

在项目根目录执行：

```bash
node seed_dictionaries.js
```

预期结果：

- `skill_dictionary` 中存在最小技能字典数据。

---

#### 3. 执行索引构建脚本

在项目根目录执行：

```bash
node build_search_index.js
```

预期结果：

- 脚本执行成功。
- 控制台输出索引构建数量。
- `candidate_search_index` 表中有数据。

---

#### 4. 验证索引总数

执行 SQL：

```sql
SELECT COUNT(*)
FROM candidate_search_index;
```

预期结果：

- 记录数应与 `candidate_resumes` 基本一致。
- 如果原始数据为 500 条，则预期索引也为 `500` 条。

---

#### 5. 验证 `Spring Boot` 技能召回

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

预期结果：

- 能查询到候选人。
- 返回记录的 `matched_skills` 包含 `Spring Boot`。
- 返回字段中不包含完整原始简历字段 `experience_if`。

---

#### 6. 验证 `Java` 技能召回

执行 SQL：

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

预期结果：

- 能查询到候选人。
- 返回记录的 `matched_skills` 包含 `Java`。

---

#### 7. 抽样检查索引字段

执行 SQL：

```sql
SELECT
  user_id,
  name,
  latest_company,
  latest_title,
  matched_skills,
  LEFT(full_text, 200) AS full_text_preview
FROM candidate_search_index
LIMIT 5;
```

检查内容：

- `user_id`、`name` 有值。
- `latest_company` 尽量有值。
- `latest_title` 尽量有值。
- `matched_skills` 是 `TEXT[]`。
- `full_text_preview` 能看到候选人相关文本，用于调试索引构建。

注意：

- `full_text` 仅用于当前阶段手工调试。
- 后续 n8n Webhook 列表查询不应返回 `full_text`。

---

### 验收标准

该 Issue 完成时，应满足以下条件：

- `node seed_dictionaries.js` 执行成功。
- `node build_search_index.js` 执行成功。
- 数据库中存在 `candidate_search_index` 表。
- `candidate_search_index` 中有候选人索引数据。
- 如果原始数据为 500 条，则索引表应接近或等于 500 条。
- 能通过 SQL 查询到 `matched_skills` 包含 `Spring Boot` 的候选人。
- 能通过 SQL 查询到 `matched_skills` 包含 `Java` 的候选人。
- 索引中包含 `latest_company` 和 `latest_title` 字段。
- 当前阶段不接入 n8n 技能查询。
- 当前阶段不处理公司标签。
- 当前阶段不调用 LLM。

---

### 测试记录模板

执行完成后，可在本 Issue 下方补充测试记录：

```text
执行日期：
执行人：

1. node seed_dictionaries.js 执行结果：
2. node build_search_index.js 执行结果：
3. candidate_search_index 总记录数：
4. Spring Boot 查询返回数量：
5. Java 查询返回数量：
6. latest_company 抽样检查结果：
7. latest_title 抽样检查结果：
8. 遗留问题：
```

---

### 风险与注意事项

- 技能匹配不要直接保存用户输入原词，应保存标准技能名，例如统一保存 `Spring Boot`。
- 当前匹配规则可以简单，但必须可解释、可复现。
- 如果 `experience_if` JSON 解析失败，需要回到基础数据阶段修复。
- 如果 `matched_skills` 为空的候选人很多，需要检查字典覆盖率和测试数据生成逻辑。
- 不要在本阶段提前实现“国内大厂”“世界500强”等公司标签能力。
- 不要把 `full_text` 作为 n8n 列表查询返回字段。

---

### 下一步

通过本 Issue 后，再进入下一个 Issue：将固定技能索引查询接入 n8n Webhook，不使用 LLM。