-- Active: 1784124345614@@192.168.123.171@5432@resume
# Epic 02：最小技能字典与技能归一化基础

## 状态
已完成

## Issue 01：创建最小技能字典并支持 Spring Boot 归一化

### 背景

在基础数据和 n8n 到 PostgreSQL 的最小链路验证通过后，下一步需要引入第一个可控的归一化能力：技能字典。

本 Issue 对应 MVP 计划中的：

- Step 2：创建最小技能字典，只解决一个问题：Springboot 归一化

该阶段只创建 `skill_dictionary`，并插入少量高频技能数据。目标不是一次性维护完整技能体系，而是用最小字典验证后续索引构建和技能检索的基础能力。

---

### 目标

创建并初始化 `skill_dictionary` 表，使系统能够识别并统一表示以下技能：

- `Java`
- `Spring Boot`
- `微服务`

其中重点验证：

- `SpringBoot`
- `springboot`
- `spring boot`

都可以通过字典归一化到标准技能名 `Spring Boot`。

---

### 范围

#### 包含

- 新增脚本 `seed_dictionaries.js`。
- 创建 `skill_dictionary` 表。
- 插入第一批最小技能字典数据。
- 支持重复执行脚本时使用 upsert 更新数据。
- 使用 SQL 验证 `Spring Boot` 记录及其别名和相关词。

#### 不包含

- 不创建公司字典。
- 不构建 `candidate_search_index`。
- 不接入 n8n 技能查询。
- 不做自然语言解析。
- 不调用 LLM。
- 不实现完整技能体系。
- 不做候选人检索或排序。

---

### 前置条件

- Epic 01 / Issue 01 已完成：原始简历数据可用。
- Epic 01 / Issue 02 已完成：n8n 到 PostgreSQL 的最小查询链路可用。
- PostgreSQL 数据库可用。
- 项目可以执行 Node.js 脚本。
- 项目根目录存在 `package.json`。

---

### 数据表设计

需要创建 `skill_dictionary` 表：

```sql
CREATE TABLE IF NOT EXISTS skill_dictionary (
  id BIGSERIAL PRIMARY KEY,
  skill_name VARCHAR(100) NOT NULL UNIQUE,
  aliases TEXT[] NOT NULL DEFAULT '{}',
  related_terms TEXT[] NOT NULL DEFAULT '{}',
  category VARCHAR(100),
  weight INT NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

字段说明：

| 字段 | 说明 |
|---|---|
| `id` | 字典记录主键 |
| `skill_name` | 标准技能名称，例如 `Spring Boot` |
| `aliases` | 技能别名，例如 `SpringBoot`、`springboot`、`spring boot` |
| `related_terms` | 相关技能或关联词，用于后续扩展召回和打分 |
| `category` | 技能分类，例如 `后端开发` |
| `weight` | 技能权重，后续可用于排序 |
| `created_at` | 创建时间 |
| `updated_at` | 更新时间 |

---

### 第一批字典数据

本阶段只维护最小必要数据：

```sql
INSERT INTO skill_dictionary
(skill_name, aliases, related_terms, category, weight)
VALUES
('Java', ARRAY['J2EE', 'Java后端'], ARRAY['Spring Boot', 'Spring Cloud', 'MyBatis', '微服务'], '后端开发', 5),
('Spring Boot', ARRAY['SpringBoot', 'springboot', 'spring boot'], ARRAY['Java', 'Spring Cloud', '微服务'], '后端开发', 5),
('微服务', ARRAY['Microservices', 'microservice'], ARRAY['Java', 'Spring Boot', 'Spring Cloud'], '架构', 4)
ON CONFLICT (skill_name) DO UPDATE SET
  aliases = EXCLUDED.aliases,
  related_terms = EXCLUDED.related_terms,
  category = EXCLUDED.category,
  weight = EXCLUDED.weight,
  updated_at = NOW();
```

---

### 实施步骤

#### 1. 新增 `seed_dictionaries.js`

在项目根目录新增脚本：

```text
seed_dictionaries.js
```

脚本职责：

1. 连接 PostgreSQL。
2. 创建 `skill_dictionary` 表。
3. 插入或更新第一批技能字典数据。
4. 输出执行结果。
5. 正常关闭数据库连接。

建议脚本具备以下特性：

- 可重复执行。
- 如果表已存在，不报错。
- 如果字典记录已存在，执行更新。
- 执行失败时输出明确错误信息。

---

#### 2. 执行字典初始化脚本

在项目根目录执行：

```bash
node seed_dictionaries.js
```

预期结果：

- 脚本执行成功。
- 控制台能看到类似 `skill_dictionary seeded successfully` 的成功信息。

---

#### 3. 验证 `skill_dictionary` 表是否存在

执行 SQL：

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_name = 'skill_dictionary';
```

预期结果：

- 能查询到 `skill_dictionary`。

---

#### 4. 验证技能字典总数

执行 SQL：

```sql
SELECT COUNT(*)
FROM skill_dictionary;
```

预期结果：

- 至少返回 `3`。

说明：

- 如果后续已有更多字典数据，数量可以大于 `3`。
- 当前 Issue 只要求本批 3 条核心记录存在。

---

#### 5. 验证 `Spring Boot` 归一化数据

执行 SQL：

```sql
SELECT *
FROM skill_dictionary
WHERE skill_name = 'Spring Boot';
```

检查内容：

- `skill_name` 为 `Spring Boot`。
- `aliases` 包含 `SpringBoot`。
- `aliases` 包含 `springboot`。
- `aliases` 包含 `spring boot`。
- `related_terms` 包含 `Java`。
- `related_terms` 包含 `Spring Cloud`。
- `related_terms` 包含 `微服务`。
- `category` 为 `后端开发`。
- `weight` 为 `5`。

---

#### 6. 验证别名查询能力

执行 SQL：

```sql
SELECT skill_name, aliases, related_terms
FROM skill_dictionary
WHERE aliases && ARRAY['springboot']::text[];
```

预期结果：

- 返回 `Spring Boot`。

再执行：

```sql
SELECT skill_name, aliases, related_terms
FROM skill_dictionary
WHERE aliases && ARRAY['SpringBoot']::text[];
```

预期结果：

- 返回 `Spring Boot`。

---

### 验收标准

该 Issue 完成时，应满足以下条件：

- 项目根目录存在 `seed_dictionaries.js`。
- 执行 `node seed_dictionaries.js` 无报错。
- 数据库中存在 `skill_dictionary` 表。
- `skill_dictionary` 中存在 `Java`、`Spring Boot`、`微服务` 三条核心记录。
- `Spring Boot` 的 `aliases` 包含 `SpringBoot`、`springboot`、`spring boot`。
- `Spring Boot` 的 `related_terms` 包含 `Java`、`Spring Cloud`、`微服务`。
- 脚本可重复执行，不产生重复 `skill_name` 数据。
- 本阶段不接入 n8n 技能查询。
- 本阶段不调用 LLM。

---

### 测试记录模板

执行完成后，可在本 Issue 下方补充测试记录：

```text
执行日期：
执行人：

1. node seed_dictionaries.js 执行结果：
2. skill_dictionary 表是否存在：
3. skill_dictionary 总记录数：
4. Spring Boot aliases 检查结果：
5. Spring Boot related_terms 检查结果：
6. 重复执行脚本是否成功：
7. 遗留问题：
```

---

### 风险与注意事项

- 当前阶段只维护最小技能字典，不应扩展过多技能，避免 MVP 失焦。
- `skill_name` 必须唯一，否则后续归一化会出现歧义。
- `aliases` 使用 PostgreSQL `TEXT[]`，后续查询时需要注意参数类型应为 `text[]`。
- 当前别名匹配仍是精确数组匹配，不代表已经完成自然语言解析。
- 大小写、空格和中英文写法在后续 n8n Code 节点中还需要继续处理。

---

### 下一步

通过本 Issue 后，再进入下一个 Issue：构建第一版 `candidate_search_index`，先只验证技能召回能力。