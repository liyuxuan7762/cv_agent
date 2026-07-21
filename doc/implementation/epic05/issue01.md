# Epic 05：公司字典与公司标签基础

## 状态
已完成

## Issue 01：创建公司字典并支持“国内大厂”标签

### 背景

当前系统已经完成了基础数据验证、n8n 最小链路、技能字典、技能索引查询、技能归一化和相关词打分。下一步需要开始引入公司维度的结构化能力。

本 Issue 对应 MVP 计划中的：

- Step 7：增加公司字典，只解决“国内大厂”

该阶段只解决一个公司标签问题：`国内大厂`。不要一次性覆盖所有公司分类，也不要提前实现 `世界500强`、外企、上市公司等标签。

---

### 目标

创建 `company_dictionary` 表，并维护第一批公司数据，使系统能够在候选人索引中识别以下公司及其标签：

- `阿里巴巴`
- `腾讯`
- `百度`
- `字节跳动`
- `美团`
- `京东`
- `华为`

重点验证：

- 公司字典可以重复初始化。
- 候选人索引可以写入 `matched_companies`。
- 候选人索引可以写入 `company_tags`。
- 可以通过 SQL 查询命中 `国内大厂` 标签的候选人。

---

### 范围

#### 包含

- 扩展或更新 `seed_dictionaries.js`。
- 创建 `company_dictionary` 表。
- 插入第一批国内大厂公司数据。
- 扩展 `candidate_search_index` 表结构，增加公司相关字段。
- 更新 `build_search_index.js`，支持公司名称和别名匹配。
- 写入 `matched_companies` 和 `company_tags`。
- 通过 SQL 手工验证 `国内大厂` 标签召回。

#### 不包含

- 不接入 n8n 公司标签查询。
- 不处理 `世界500强`。
- 不处理复杂公司层级关系。
- 不处理公司工商主体映射。
- 不做公司名称模糊匹配。
- 不调用 LLM。
- 不让 LLM 判断公司类别。
- 不返回完整简历。

---

### 前置条件

- Epic 02 / Issue 02 已完成：`candidate_search_index` 已可构建。
- Epic 04 / Issue 01 已完成：技能查询和简单打分流程已验证。
- 项目根目录存在脚本：

```text
seed_dictionaries.js
build_search_index.js
```

- `candidate_resumes` 表中存在候选人简历数据。
- `experience_if` 中包含公司名称文本。

---

### 公司字典表设计

需要创建 `company_dictionary` 表：

```sql
CREATE TABLE IF NOT EXISTS company_dictionary (
  id BIGSERIAL PRIMARY KEY,
  company_name VARCHAR(200) NOT NULL UNIQUE,
  aliases TEXT[] NOT NULL DEFAULT '{}',
  tags TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

字段说明：

| 字段 | 说明 |
|---|---|
| `id` | 公司字典主键 |
| `company_name` | 标准公司名称，例如 `阿里巴巴` |
| `aliases` | 公司别名，例如 `阿里`、`Alibaba` |
| `tags` | 公司标签，例如 `国内大厂`、`互联网大厂`、`电商` |
| `created_at` | 创建时间 |
| `updated_at` | 更新时间 |

---

### 第一批公司数据

本阶段只维护以下公司数据：

```sql
INSERT INTO company_dictionary
(company_name, aliases, tags)
VALUES
('阿里巴巴', ARRAY['阿里', 'Alibaba'], ARRAY['国内大厂', '互联网大厂', '电商']),
('腾讯', ARRAY['Tencent'], ARRAY['国内大厂', '互联网大厂', '社交', '游戏']),
('百度', ARRAY['Baidu'], ARRAY['国内大厂', '互联网大厂', 'AI']),
('字节跳动', ARRAY['ByteDance', '抖音'], ARRAY['国内大厂', '互联网大厂', '内容平台']),
('美团', ARRAY['Meituan'], ARRAY['国内大厂', '互联网大厂', '本地生活']),
('京东', ARRAY['JD'], ARRAY['国内大厂', '互联网大厂', '电商']),
('华为', ARRAY['Huawei'], ARRAY['国内大厂', 'ICT', '制造业'])
ON CONFLICT (company_name) DO UPDATE SET
  aliases = EXCLUDED.aliases,
  tags = EXCLUDED.tags,
  updated_at = NOW();
```

---

### 索引表扩展

需要在 `candidate_search_index` 中增加公司相关字段：

```sql
ALTER TABLE candidate_search_index
ADD COLUMN IF NOT EXISTS matched_companies TEXT[] NOT NULL DEFAULT '{}',
ADD COLUMN IF NOT EXISTS company_tags TEXT[] NOT NULL DEFAULT '{}';
```

如果 `build_search_index.js` 采用重建表方式，也可以直接在建表语句中包含：

```sql
matched_companies TEXT[] NOT NULL DEFAULT '{}',
company_tags TEXT[] NOT NULL DEFAULT '{}'
```

字段说明：

| 字段 | 说明 |
|---|---|
| `matched_companies` | 候选人简历中命中的标准公司名称 |
| `company_tags` | 命中公司对应的标签集合 |

---

### 公司匹配规则

第一版公司匹配采用简单、可解释的规则：

1. 读取所有 `company_dictionary` 记录。
2. 对每位候选人构造 `full_text`。
3. 对每家公司，检查以下内容是否出现在 `full_text` 中：
   - `company_name`
   - `aliases` 中任意别名
4. 如果命中，则：
   - 将标准公司名写入 `matched_companies`。
   - 将该公司的 `tags` 合并写入 `company_tags`。
5. `matched_companies` 和 `company_tags` 都需要去重。

示例：

如果候选人文本中包含：

```text
曾任职于阿里，负责电商平台后端系统开发
```

则应写入：

```json
{
  "matched_companies": ["阿里巴巴"],
  "company_tags": ["国内大厂", "互联网大厂", "电商"]
}
```

---

### 实施步骤

#### 1. 更新 `seed_dictionaries.js`

在现有技能字典初始化逻辑基础上，增加：

1. 创建 `company_dictionary` 表。
2. 插入第一批国内大厂公司数据。
3. 使用 `ON CONFLICT (company_name) DO UPDATE` 保证脚本可重复执行。
4. 输出公司字典初始化结果。

执行：

```bash
node seed_dictionaries.js
```

预期：

- `skill_dictionary` 初始化仍然成功。
- `company_dictionary` 初始化成功。

---

#### 2. 验证公司字典

执行 SQL：

```sql
SELECT COUNT(*)
FROM company_dictionary;
```

预期：

- 至少返回 `7`。

执行 SQL：

```sql
SELECT company_name, aliases, tags
FROM company_dictionary
WHERE tags && ARRAY['国内大厂']::text[]
ORDER BY company_name;
```

预期：

- 能看到阿里巴巴、腾讯、百度、字节跳动、美团、京东、华为等公司。

---

#### 3. 更新 `build_search_index.js`

在现有索引构建逻辑中增加公司字典匹配能力。

需要确认脚本支持：

- 读取 `company_dictionary`。
- 匹配 `company_name`。
- 匹配 `aliases`。
- 写入 `matched_companies`。
- 写入 `company_tags`。
- 保留已有 `matched_skills` 构建能力。
- 保留已有 `latest_company` 和 `latest_title` 提取能力。

注意：

- 本次更新不能破坏已有技能索引能力。
- 重建索引后，`Spring Boot` 和 `Java` 技能召回应仍然可用。

---

#### 4. 重建索引

执行：

```bash
node seed_dictionaries.js
node build_search_index.js
```

预期：

- 两个脚本均执行成功。
- `candidate_search_index` 中有数据。
- 公司字段 `matched_companies` 和 `company_tags` 存在。

---

#### 5. 验证“国内大厂”召回

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

- 有候选人返回。
- `company_tags` 包含 `国内大厂`。
- `matched_companies` 中能看到第一批公司之一。

---

#### 6. 验证公司命中详情

执行 SQL：

```sql
SELECT
  matched_companies,
  company_tags,
  COUNT(*) AS candidate_count
FROM candidate_search_index
WHERE company_tags && ARRAY['国内大厂']::text[]
GROUP BY matched_companies, company_tags
ORDER BY candidate_count DESC
LIMIT 20;
```

用于观察：

- 哪些公司命中较多。
- 标签是否正确合并。
- 是否存在明显异常命中。

---

#### 7. 回归验证技能召回没有被破坏

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

- 仍然能查询到对应技能候选人。

---

### 验收标准

该 Issue 完成时，应满足以下条件：

- `seed_dictionaries.js` 能创建并初始化 `company_dictionary`。
- `company_dictionary` 中至少存在 7 条国内大厂公司记录。
- 每条国内大厂公司记录的 `tags` 至少包含 `国内大厂`。
- `build_search_index.js` 能读取并匹配公司字典。
- `candidate_search_index` 中存在 `matched_companies` 字段。
- `candidate_search_index` 中存在 `company_tags` 字段。
- 能通过 SQL 查询到 `company_tags` 包含 `国内大厂` 的候选人。
- 返回结果中 `matched_companies` 能看到阿里巴巴、腾讯、百度、字节跳动、美团、京东、华为等公司之一。
- 重建索引后，`Spring Boot` 和 `Java` 技能召回仍然可用。
- 本阶段不接入 n8n 公司标签查询。
- 本阶段不调用 LLM。

---

### 手工验证 SQL 汇总

```sql
SELECT COUNT(*)
FROM company_dictionary;
```

```sql
SELECT company_name, aliases, tags
FROM company_dictionary
WHERE tags && ARRAY['国内大厂']::text[]
ORDER BY company_name;
```

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

---

### 测试记录模板

执行完成后，可在本 Issue 下方补充测试记录：

```text
执行日期：
执行人：

1. node seed_dictionaries.js 执行结果：
2. company_dictionary 总记录数：
3. 国内大厂公司记录检查结果：
4. node build_search_index.js 执行结果：
5. candidate_search_index 总记录数：
6. 命中 国内大厂 的候选人数：
7. matched_companies 抽样结果：
8. company_tags 抽样结果：
9. Spring Boot 技能回归结果：
10. Java 技能回归结果：
11. 是否调用 LLM：
12. 遗留问题：
```

---

### 风险与注意事项

- 当前阶段只解决 `国内大厂`，不要扩展到 `世界500强` 或其他复杂标签。
- 公司别名匹配可能产生误判，例如短别名过于通用时容易误命中，需要谨慎维护。
- `matched_companies` 应保存标准公司名，而不是保存别名。
- `company_tags` 应来自字典，不应由 LLM 或用户输入直接生成。
- 重建索引时不能破坏已有技能匹配能力。
- n8n 查询公司标签将在后续 Issue 中实现，本阶段只做数据库和索引验证。

---

### 下一步

通过本 Issue 后，再进入下一个 Issue：把“国内大厂”公司标签查询接入 n8n Webhook。