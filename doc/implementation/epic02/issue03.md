# Epic 02：最小技能字典与技能归一化基础

## 状态
已完成

## Issue 03：在候选人搜索索引中补充教育背景信息

### 背景

在 Epic 02 / Issue 02 完成后，`candidate_search_index` 的 `full_text` 仅拼接了候选人的个人简介（`personal`）和工作经历（`experience_if`）。

`candidate_resumes` 表中还存有教育背景字段 `education`，其中包含学校名称、专业、学历层次和教育描述。这些信息目前未被纳入索引，导致：

1. 教育描述中出现的技能词（如专业课程、毕业设计方向）无法被技能匹配命中。
2. 后续学历筛选所需的结构化字段（如 `highest_degree`）尚未提取。

本 Issue 分两部分处理教育背景：

- **Part 1（本 Issue 范围）**：将教育文本补充进 `full_text`，提升技能召回覆盖率。同时提取结构化字段 `highest_degree`，写入索引表，为后续学历筛选做准备。
- **Part 2（后续 Epic）**：将 `highest_degree` 接入 n8n 查询条件，支持按学历筛选候选人。

---

### 目标

1. 在 `build_search_index.js` 的 `buildFullText` 函数中补充教育背景文本。
2. 在 `candidate_search_index` 表中新增 `highest_degree` 字段。
3. 从 `education` JSON 中提取最高学历，写入 `highest_degree`。
4. 重新执行索引构建，验证技能召回数量是否有提升。

---

### 范围

#### 包含

- 修改 `build_search_index.js`：
  - `buildFullText` 补充教育描述文本。
  - 新增 `extractHighestDegree` 函数，从 `education` JSON 中提取最高学历。
- 修改 `candidate_search_index` 表结构：新增 `highest_degree VARCHAR(20)` 字段。
- 重新执行 `node build_search_index.js`。
- 使用 SQL 验证 `highest_degree` 字段有值。
- 对比补充教育文本前后技能召回数量变化（可选，记录在测试记录中）。

#### 不包含

- 不在 n8n 中接入 `highest_degree` 筛选。
- 不创建学历字典。
- 不做"名校标签"处理。
- 不处理"985/211"等学校分类。
- 不调用 LLM。
- 不修改 `skill_dictionary`。

---

### 前置条件

- Epic 02 / Issue 02 已完成：`candidate_search_index` 已构建，技能召回验证通过。
- `candidate_resumes.education` 字段为合法 JSON 数组字符串。
- `education` JSON 结构示例：

```json
[
  {
    "startDate": "2013-09-01",
    "endDate": "2017-06-30",
    "school": "浙江大学",
    "major": "计算机科学与技术",
    "degree": "本科",
    "description": "系统学习数据结构、算法、操作系统等核心课程，毕业设计方向为分布式系统。"
  },
  {
    "startDate": "2017-09-01",
    "endDate": "2020-06-30",
    "school": "上海交通大学",
    "major": "软件工程",
    "degree": "硕士研究生",
    "description": "研究方向为微服务架构与容器化部署，参与实验室 Kubernetes 相关课题。"
  }
]
```

---

### 表结构变更

在 `candidate_search_index` 中新增字段：

```sql
ALTER TABLE candidate_search_index
  ADD COLUMN IF NOT EXISTS highest_degree VARCHAR(20);
```

字段说明：

| 字段 | 类型 | 说明 |
|---|---|---|
| `highest_degree` | `VARCHAR(20)` | 最高学历，取值：`专科`、`本科`、`硕士研究生`、`博士研究生`，无法识别时为 `NULL` |

学历优先级（从高到低）：

```
博士研究生 > 硕士研究生 > 本科 > 专科
```

---

### 实施步骤

#### 1. 修改 `build_search_index.js`

**1.1 在 `createIndexTable` 中补充 `highest_degree` 字段**

在建表 DDL 中增加字段：

```sql
highest_degree VARCHAR(20)
```

同时增加 `ALTER TABLE` 兜底语句，保证对已存在的旧表也能添加字段：

```javascript
await pool.query(`
  ALTER TABLE candidate_search_index
    ADD COLUMN IF NOT EXISTS highest_degree VARCHAR(20);
`);
```

---

**1.2 修改 `buildFullText`，补充教育背景文本**

当前 `buildFullText` 只拼接了 `personal` 和 `experience_if`。

修改后，增加教育背景文本拼接：

```javascript
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
```

说明：

- 拼入 `school`、`major`、`description`，不拼入 `degree`（`degree` 通过结构化字段单独处理）。
- 教育描述中可能包含技能词，例如"毕业设计方向为微服务架构"。

---

**1.3 新增 `extractHighestDegree` 函数**

学历优先级定义：

```javascript
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
```

---

**1.4 修改 `main` 中读取 `education` 字段**

在 `SELECT` 语句中增加 `education` 字段：

```sql
SELECT
  user_id, name, gender, birthdate,
  aim_salary, personal, applied_at,
  experience_if, education
FROM candidate_resumes
ORDER BY user_id
```

在循环中增加解析和调用：

```javascript
const educations   = safeParseEducation(resume.education);
const fullText     = buildFullText(resume, experiences, educations);
const highestDegree = extractHighestDegree(educations);
```

---

**1.5 新增 `safeParseEducation` 函数**

与 `safeParseExperience` 保持一致的防御性解析：

```javascript
function safeParseEducation(educationField) {
  try {
    const parsed = JSON.parse(educationField);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
```

---

**1.6 修改 `upsertCandidateIndex`，写入 `highest_degree`**

在 INSERT 字段列表和 VALUES 中增加 `highest_degree`，在 `ON CONFLICT DO UPDATE` 中同步更新。

---

#### 2. 执行索引重建

```bash
node build_search_index.js
```

预期输出：

- 脚本正常完成，无报错。
- 控制台输出索引构建数量。
- 末尾验证输出 Spring Boot 和 Java 的召回数量。

---

#### 3. 验证 `highest_degree` 字段

执行 SQL，检查学历分布：

```sql
SELECT highest_degree, COUNT(*) AS cnt
FROM candidate_search_index
GROUP BY highest_degree
ORDER BY cnt DESC;
```

预期结果：

- 出现 `本科`、`硕士研究生`、`专科`、`博士研究生` 等值。
- `NULL` 数量应为 0 或极少（取决于测试数据质量）。

---

#### 4. 抽样验证字段完整性

```sql
SELECT
  user_id,
  name,
  highest_degree,
  matched_skills,
  LEFT(full_text, 300) AS full_text_preview
FROM candidate_search_index
LIMIT 5;
```

检查内容：

- `highest_degree` 有值。
- `full_text_preview` 中能看到学校或专业名称。
- `matched_skills` 与之前相比有无新增命中（可选对比）。

---

#### 5. 验证技能召回数量（可选对比）

执行以下 SQL，对比补充教育文本前后的召回数量变化：

```sql
-- Spring Boot 召回数
SELECT COUNT(*)
FROM candidate_search_index
WHERE matched_skills && ARRAY['Spring Boot']::text[];

-- Java 召回数
SELECT COUNT(*)
FROM candidate_search_index
WHERE matched_skills && ARRAY['Java']::text[];

-- 微服务 召回数
SELECT COUNT(*)
FROM candidate_search_index
WHERE matched_skills && ARRAY['微服务']::text[];
```

说明：

- 如果教育描述中包含相关技能词，召回数量会略有提升。
- 如果测试数据的教育描述中没有技能词，召回数量可能不变，这是正常的。
- 将结果记录在测试记录中，用于后续对比。

---

### 验收标准

该 Issue 完成时，应满足以下条件：

- `node build_search_index.js` 执行成功，无报错。
- `candidate_search_index` 表包含 `highest_degree` 字段。
- `highest_degree` 字段有值，分布合理（本科/硕士/专科/博士）。
- `full_text` 中能看到学校名称或专业名称（通过抽样验证）。
- Spring Boot 和 Java 的技能召回数量不低于 Issue 02 验证结果。
- 当前阶段不接入 n8n 学历筛选。
- 当前阶段不处理名校标签。
- 当前阶段不调用 LLM。

---

### 测试记录模板

执行完成后，可在本 Issue 下方补充测试记录：

```text
执行日期：
执行人：

1. node build_search_index.js 执行结果：
2. highest_degree 学历分布（各学历数量）：
3. full_text 中是否能看到学校/专业名称：
4. Issue 02 时 Spring Boot 召回数：
5. 本次 Spring Boot 召回数：
6. Issue 02 时 Java 召回数：
7. 本次 Java 召回数：
8. 遗留问题：
```

---

### 风险与注意事项

- `education` 字段 JSON 解析失败时，应静默跳过，不中断整体索引构建。
- `highest_degree` 只保存已知学历值，未知值（如空字符串、非标准写法）应保存为 `NULL`。
- 本阶段不要提前实现"985/211"等名校标签，避免 MVP 失焦。
- `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` 保证脚本可重复执行，不会因字段已存在而报错。
- 教育文本拼入 `full_text` 后，`full_text` 体积会略有增大，属于预期行为。

---

### 下一步

通过本 Issue 后，`candidate_search_index` 已具备教育背景基础字段。

后续在需要"按学历筛选候选人"的 Epic 中，直接使用 `highest_degree` 字段即可，无需再修改索引构建逻辑。