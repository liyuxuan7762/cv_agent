# Epic 10：名校标签体系

## Issue 01：创建学校字典并支持名校标签索引构建

### 背景

当前系统已经完成技能字典、公司字典的索引构建和 n8n 查询接入。公司字典通过 `matched_companies` 和 `company_tags` 两个字段实现了标签化筛选，并已在 Epic 05～07 中完整验证。

名校标签与公司标签**完全同构**：

- 公司字典：`company_name` + `aliases` + `tags` → `matched_companies` + `company_tags`
- 学校字典：`school_name` + `aliases` + `tags` → `matched_schools` + `school_tags`

本 Issue 对应名校标签体系的数据层建设，目标是创建 `school_dictionary`，重建候选人索引，并通过 SQL 验证名校标签召回能力。

---

### 目标

1. 扩展 `seed_dictionaries.js`，创建并初始化 `school_dictionary`。
2. 扩展 `build_search_index.js`，支持学校名称和别名匹配，写入 `matched_schools` 和 `school_tags`。
3. 扩展 `candidate_search_index` 表结构，新增 `matched_schools` 和 `school_tags` 字段。
4. 重建候选人索引。
5. 通过 SQL 验证名校标签召回能力。

---

### 范围

#### 包含

- 扩展 `seed_dictionaries.js`：
  - 创建 `school_dictionary` 表。
  - 插入第一批名校数据（985 高校为主）。
  - 支持脚本可重复执行（upsert）。
- 扩展 `build_search_index.js`：
  - 读取 `school_dictionary`。
  - 匹配 `full_text` 中的学校名称和别名。
  - 写入 `matched_schools`（标准学校名）。
  - 写入 `school_tags`（学校标签，如 `985`、`211`、`双一流`）。
- 扩展 `candidate_search_index` 表结构：
  - 新增 `matched_schools TEXT[] NOT NULL DEFAULT '{}'`。
  - 新增 `school_tags TEXT[] NOT NULL DEFAULT '{}'`。
- 重新执行 `node build_search_index.js`。
- 使用 SQL 验证 `985` 标签召回。
- 回归验证技能召回和公司标签召回不被破坏。

#### 不包含

- 不在 n8n 中接入名校标签查询（留给 Issue 02）。
- 不处理"名校"的模糊定义（以字典标签为准）。
- 不处理学校历史名称变更。
- 不处理学院/系级别的匹配。
- 不调用 LLM。

---

### 前置条件

- Epic 02 / Issue 03 已完成：`candidate_search_index` 已包含 `highest_degree` 字段，`full_text` 已拼入教育背景文本（学校名称已在 `full_text` 中）。
- Epic 05 / Issue 01 已完成：`company_dictionary` 已创建，`build_search_index.js` 已具备字典匹配能力。
- `seed_dictionaries.js` 和 `build_search_index.js` 可正常执行。
- `candidate_resumes.education` 中包含学校名称字段。

---

### 学校字典表设计

```sql
CREATE TABLE IF NOT EXISTS school_dictionary (
  id           BIGSERIAL    PRIMARY KEY,
  school_name  VARCHAR(200) NOT NULL UNIQUE,
  aliases      TEXT[]       NOT NULL DEFAULT '{}',
  tags         TEXT[]       NOT NULL DEFAULT '{}',
  created_at   TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMP    NOT NULL DEFAULT NOW()
);
```

字段说明：

| 字段 | 说明 |
|---|---|
| `school_name` | 标准学校名称，例如 `清华大学` |
| `aliases` | 学校别名，例如 `清华`、`Tsinghua` |
| `tags` | 学校标签，例如 `985`、`211`、`双一流`、`C9` |

---

### 第一批学校数据

本阶段只维护 C9 联盟高校（9 所）+ 少量其他 985 高校，覆盖测试数据中出现频率最高的学校。

```sql
INSERT INTO school_dictionary (school_name, aliases, tags)
VALUES
  ('北京大学',     ARRAY['北大', 'PKU', 'Peking University'],          ARRAY['985', '211', '双一流', 'C9']),
  ('清华大学',     ARRAY['清华', 'THU', 'Tsinghua University'],        ARRAY['985', '211', '双一流', 'C9']),
  ('复旦大学',     ARRAY['复旦', 'Fudan University'],                  ARRAY['985', '211', '双一流', 'C9']),
  ('上海交通大学', ARRAY['上交', '交大', 'SJTU'],                      ARRAY['985', '211', '双一流', 'C9']),
  ('浙江大学',     ARRAY['浙大', 'ZJU', 'Zhejiang University'],        ARRAY['985', '211', '双一流', 'C9']),
  ('南京大学',     ARRAY['南大', 'NJU', 'Nanjing University'],         ARRAY['985', '211', '双一流', 'C9']),
  ('中国科学技术大学', ARRAY['中科大', 'USTC'],                        ARRAY['985', '211', '双一流', 'C9']),
  ('哈尔滨工业大学',   ARRAY['哈工大', 'HIT'],                        ARRAY['985', '211', '双一流', 'C9']),
  ('西安交通大学', ARRAY['西交', '西交大', 'XJTU'],                    ARRAY['985', '211', '双一流', 'C9']),
  ('武汉大学',     ARRAY['武大', 'WHU', 'Wuhan University'],           ARRAY['985', '211', '双一流']),
  ('华中科技大学', ARRAY['华科', 'HUST'],                              ARRAY['985', '211', '双一流']),
  ('中山大学',     ARRAY['中大', 'SYSU'],                              ARRAY['985', '211', '双一流']),
  ('同济大学',     ARRAY['同济', 'Tongji University'],                 ARRAY['985', '211', '双一流']),
  ('北京航空航天大学', ARRAY['北航', 'BUAA'],                         ARRAY['985', '211', '双一流']),
  ('北京理工大学', ARRAY['北理工', 'BIT'],                             ARRAY['985', '211', '双一流']),
  ('东南大学',     ARRAY['东大', 'SEU'],                               ARRAY['985', '211', '双一流']),
  ('厦门大学',     ARRAY['厦大', 'XMU'],                               ARRAY['985', '211', '双一流']),
  ('四川大学',     ARRAY['川大', 'SCU'],                               ARRAY['985', '211', '双一流']),
  ('中南大学',     ARRAY['中南', 'CSU'],                               ARRAY['985', '211', '双一流']),
  ('吉林大学',     ARRAY['吉大', 'JLU'],                               ARRAY['985', '211', '双一流']),
  ('山东大学',     ARRAY['山大', 'SDU'],                               ARRAY['985', '211', '双一流']),
  ('电子科技大学', ARRAY['电科大', 'UESTC'],                           ARRAY['985', '211', '双一流']),
  ('北京邮电大学', ARRAY['北邮', 'BUPT'],                              ARRAY['211', '双一流']),
  ('华南理工大学', ARRAY['华工', 'SCUT'],                              ARRAY['985', '211', '双一流']),
  ('重庆大学',     ARRAY['重大', 'CQU'],                               ARRAY['985', '211', '双一流']),
  ('天津大学',     ARRAY['天大', 'TJU'],                               ARRAY['985', '211', '双一流']),
  ('大连理工大学', ARRAY['大工', 'DUT'],                               ARRAY['985', '211', '双一流']),
  ('南开大学',     ARRAY['南开', 'NKU'],                               ARRAY['985', '211', '双一流']),
  ('西北工业大学', ARRAY['西工大', 'NPU'],                             ARRAY['985', '211', '双一流']),
  ('湖南大学',     ARRAY['湖大', 'HNU'],                               ARRAY['985', '211', '双一流'])
ON CONFLICT (school_name) DO UPDATE SET
  aliases    = EXCLUDED.aliases,
  tags       = EXCLUDED.tags,
  updated_at = NOW();
```

标签说明：

| 标签 | 说明 |
|---|---|
| `985` | 985 工程高校 |
| `211` | 211 工程高校 |
| `双一流` | 双一流建设高校 |
| `C9` | C9 联盟高校（顶尖 9 所） |

---

### 索引表扩展

在 `candidate_search_index` 中新增两个字段：

```sql
ALTER TABLE candidate_search_index
  ADD COLUMN IF NOT EXISTS matched_schools TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS school_tags     TEXT[] NOT NULL DEFAULT '{}';
```

字段说明：

| 字段 | 说明 |
|---|---|
| `matched_schools` | 候选人简历中命中的标准学校名称 |
| `school_tags` | 命中学校对应的标签集合，如 `985`、`211`、`C9` |

---

### 学校匹配规则

与公司匹配规则完全一致：

1. 读取所有 `school_dictionary` 记录。
2. 对每位候选人的 `full_text` 进行匹配（`full_text` 已包含教育背景文本，由 Epic 02 / Issue 03 保证）。
3. 对每所学校，检查 `school_name` 或任意 `aliases` 是否出现在 `full_text` 中。
4. 如果命中：
   - 将标准学校名写入 `matched_schools`。
   - 将该学校的 `tags` 合并写入 `school_tags`。
5. `matched_schools` 和 `school_tags` 均需去重后保存。

示例：

如果候选人 `full_text` 中包含：

```text
就读于清华大学计算机科学与技术专业
```

则应写入：

```json
{
  "matched_schools": ["清华大学"],
  "school_tags": ["985", "211", "双一流", "C9"]
}
```

---

### 实施步骤

#### 1. 扩展 `seed_dictionaries.js`

在现有技能字典和公司字典初始化逻辑之后，增加：

1. 创建 `school_dictionary` 表。
2. 插入第一批名校数据（upsert）。
3. 输出初始化结果。

执行：

```bash
node seed_dictionaries.js
```

预期：

- `skill_dictionary` 初始化仍然成功。
- `company_dictionary` 初始化仍然成功。
- `school_dictionary` 初始化成功，输出类似：`Upserted school: "清华大学"`。

---

#### 2. 验证学校字典

执行 SQL：

```sql
SELECT COUNT(*) AS total FROM school_dictionary;
```

预期：至少 30 条。

执行 SQL：

```sql
SELECT school_name, aliases, tags
FROM school_dictionary
WHERE tags && ARRAY['C9']::text[]
ORDER BY school_name;
```

预期：返回 9 所 C9 联盟高校。

执行 SQL：

```sql
SELECT school_name, aliases, tags
FROM school_dictionary
WHERE tags && ARRAY['985']::text[]
ORDER BY school_name;
```

预期：返回所有 985 高校记录。

---

#### 3. 扩展 `build_search_index.js`

**3.1 在 `createIndexTable` 中补充字段和索引**

建表 DDL 中增加：

```sql
matched_schools TEXT[] NOT NULL DEFAULT '{}',
school_tags     TEXT[] NOT NULL DEFAULT '{}'
```

同时增加 `ALTER TABLE` 兜底：

```javascript
await pool.query(`
  ALTER TABLE candidate_search_index
    ADD COLUMN IF NOT EXISTS matched_schools TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS school_tags     TEXT[] NOT NULL DEFAULT '{}';
`);
```

增加 GIN 索引：

```sql
CREATE INDEX IF NOT EXISTS idx_csi_school_tags
  ON candidate_search_index USING GIN(school_tags);
```

---

**3.2 新增 `loadSchoolDictionary` 函数**

与 `loadCompanyDictionary` 完全对称：

```javascript
async function loadSchoolDictionary() {
  const result = await pool.query(`
    SELECT school_name, aliases, tags
    FROM school_dictionary
  `);

  return result.rows.map(row => ({
    schoolName: row.school_name,
    terms: unique([
      row.school_name,
      ...(row.aliases || []),
    ]),
    tags: row.tags || [],
  }));
}
```

---

**3.3 新增 `findMatchedSchools` 函数**

与 `findMatchedCompanies` 完全对称：

```javascript
function findMatchedSchools(fullText, schoolDict) {
  const matchedSchools = [];
  const schoolTags = [];

  for (const school of schoolDict) {
    const hit = school.terms.some(term => includesTerm(fullText, term));
    if (hit) {
      matchedSchools.push(school.schoolName);
      schoolTags.push(...school.tags);
    }
  }

  return {
    matchedSchools: unique(matchedSchools),
    schoolTags:     unique(schoolTags),
  };
}
```

---

**3.4 修改 `main`，加载学校字典并写入索引**

在 `main` 中加载字典：

```javascript
const schoolDict = await loadSchoolDictionary();
console.log(`Loaded ${schoolDict.length} schools from school_dictionary.`);
```

在循环中调用：

```javascript
const { matchedSchools, schoolTags } = findMatchedSchools(fullText, schoolDict);
```

在 `upsertCandidateIndex` 调用中传入：

```javascript
matched_schools: matchedSchools,
school_tags:     schoolTags,
```

---

**3.5 修改 `upsertCandidateIndex`，写入新字段**

在 INSERT 字段列表、VALUES 和 `ON CONFLICT DO UPDATE` 中同步增加 `matched_schools` 和 `school_tags`。

---

**3.6 在末尾验证中增加名校标签召回统计**

```javascript
const c9Result = await pool.query(`
  SELECT COUNT(*) AS cnt
  FROM candidate_search_index
  WHERE school_tags && ARRAY['C9']::text[];
`);
console.log(`[Verification] school_tags contains 'C9' : ${c9Result.rows[0].cnt} records`);

const s985Result = await pool.query(`
  SELECT COUNT(*) AS cnt
  FROM candidate_search_index
  WHERE school_tags && ARRAY['985']::text[];
`);
console.log(`[Verification] school_tags contains '985': ${s985Result.rows[0].cnt} records`);
```

---

#### 4. 重建索引

```bash
node seed_dictionaries.js
node build_search_index.js
```

---

#### 5. 手工验证 SQL

**验证 985 标签召回：**

```sql
SELECT
  user_id,
  name,
  highest_degree,
  matched_schools,
  school_tags
FROM candidate_search_index
WHERE school_tags && ARRAY['985']::text[]
LIMIT 10;
```

**验证 C9 标签召回：**

```sql
SELECT
  user_id,
  name,
  matched_schools,
  school_tags
FROM candidate_search_index
WHERE school_tags && ARRAY['C9']::text[]
LIMIT 10;
```

**验证学校命中分布：**

```sql
SELECT
  matched_schools,
  school_tags,
  COUNT(*) AS candidate_count
FROM candidate_search_index
WHERE school_tags && ARRAY['985']::text[]
GROUP BY matched_schools, school_tags
ORDER BY candidate_count DESC
LIMIT 20;
```

**回归验证技能召回：**

```sql
SELECT COUNT(*) FROM candidate_search_index
WHERE matched_skills && ARRAY['Spring Boot']::text[];

SELECT COUNT(*) FROM candidate_search_index
WHERE matched_skills && ARRAY['Java']::text[];
```

**回归验证公司标签召回：**

```sql
SELECT COUNT(*) FROM candidate_search_index
WHERE company_tags && ARRAY['国内大厂']::text[];
```

---

### 验收标准

该 Issue 完成时，应满足以下条件：

- `seed_dictionaries.js` 能创建并初始化 `school_dictionary`。
- `school_dictionary` 中至少存在 30 条学校记录。
- C9 高校均存在，且 `tags` 包含 `C9`、`985`、`211`、`双一流`。
- `build_search_index.js` 能读取并匹配学校字典。
- `candidate_search_index` 中存在 `matched_schools` 字段。
- `candidate_search_index` 中存在 `school_tags` 字段。
- 能通过 SQL 查询到 `school_tags` 包含 `985` 的候选人。
- 能通过 SQL 查询到 `school_tags` 包含 `C9` 的候选人。
- 返回结果中 `matched_schools` 能看到至少一所 985 高校。
- 重建索引后，`Spring Boot` 和 `Java` 技能召回仍然可用。
- 重建索引后，`国内大厂` 公司标签召回仍然可用。
- 本阶段不接入 n8n 名校标签查询。
- 本阶段不调用 LLM。

---

### 测试记录模板

```text
执行日期：
执行人：

1. node seed_dictionaries.js 执行结果：
2. school_dictionary 总记录数：
3. C9 高校记录检查结果：
4. 985 高校记录数：
5. node build_search_index.js 执行结果：
6. candidate_search_index 总记录数：
7. 命中 985 标签的候选人数：
8. 命中 C9 标签的候选人数：
9. matched_schools 抽样结果：
10. school_tags 抽样结果：
11. Spring Boot 技能回归结果：
12. Java 技能回归结果：
13. 国内大厂公司标签回归结果：
14. 遗留问题：
```

---

### 风险与注意事项

- 学校别名应谨慎维护，短别名（如"交大"）可能在多所学校间产生歧义，本阶段暂不处理歧义消解。
- `matched_schools` 应保存标准学校名，不保存别名。
- `school_tags` 应来自字典，不应由 LLM 或用户输入直接生成。
- 重建索引时不能破坏已有技能匹配和公司标签匹配能力。
- 本阶段 `full_text` 已包含教育背景文本（由 Epic 02 / Issue 03 保证），无需再修改 `buildFullText`。

---

### 下一步

通过本 Issue 后，再进入 Issue 02：将名校标签查询接入 n8n Webhook，支持用户通过"985 高校""C9""双一流"等关键词筛选候选人。