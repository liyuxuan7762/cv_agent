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

// ════════════════════════════════════════════════════════════════════
// 技能字典
// ════════════════════════════════════════════════════════════════════

const CREATE_SKILL_TABLE_SQL = `
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

async function createSkillTable() {
  await pool.query(CREATE_SKILL_TABLE_SQL);
  console.log('Table skill_dictionary is ready.');
}

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

async function seedSkillDictionary() {
  for (const row of SKILL_DICTIONARY_ROWS) {
    await upsertSkill(row);
    console.log(`  Upserted skill: "${row.skill_name}"`);
  }
}

async function verifySkillSeedResult() {
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

  const requiredAliases = ['SpringBoot', 'springboot', 'spring boot'];
  const missingAliases = requiredAliases.filter(a => !sb.aliases.includes(a));
  if (missingAliases.length > 0) {
    console.error(`  Verification FAILED: missing aliases: ${missingAliases.join(', ')}`);
  } else {
    console.log('  aliases check : PASSED');
  }

  const requiredRelated = ['Java', 'Spring Cloud', '微服务'];
  const missingRelated = requiredRelated.filter(t => !sb.related_terms.includes(t));
  if (missingRelated.length > 0) {
    console.error(`  Verification FAILED: missing related_terms: ${missingRelated.join(', ')}`);
  } else {
    console.log('  related_terms check: PASSED');
  }
}

// ════════════════════════════════════════════════════════════════════
// 公司字典
// ════════════════════════════════════════════════════════════════════

const CREATE_COMPANY_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS company_dictionary (
    id           BIGSERIAL    PRIMARY KEY,
    company_name VARCHAR(200) NOT NULL UNIQUE,
    aliases      TEXT[]       NOT NULL DEFAULT '{}',
    tags         TEXT[]       NOT NULL DEFAULT '{}',
    created_at   TIMESTAMP    NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMP    NOT NULL DEFAULT NOW()
  );
`;

const COMPANY_DICTIONARY_ROWS = [

  // ── 国内互联网大厂 ────────────────────────────────────────────
  {
    company_name: '阿里巴巴',
    aliases:      ['阿里', 'Alibaba', '淘宝', '天猫', '蚂蚁集团', '蚂蚁金服'],
    tags:         ['国内大厂', '互联网大厂', '电商'],
  },
  {
    company_name: '腾讯',
    aliases:      ['Tencent', '微信', 'QQ'],
    tags:         ['国内大厂', '互联网大厂', '社交', '游戏'],
  },
  {
    company_name: '百度',
    aliases:      ['Baidu'],
    tags:         ['国内大厂', '互联网大厂', 'AI', '搜索'],
  },
  {
    company_name: '字节跳动',
    aliases:      ['ByteDance', '抖音', 'TikTok', '今日头条'],
    tags:         ['国内大厂', '互联网大厂', '内容平台'],
  },
  {
    company_name: '美团',
    aliases:      ['Meituan', '美团点评'],
    tags:         ['国内大厂', '互联网大厂', '本地生活'],
  },
  {
    company_name: '京东',
    aliases:      ['JD', 'JD.com', '京东商城'],
    tags:         ['国内大厂', '互联网大厂', '电商'],
  },
  {
    company_name: '华为',
    aliases:      ['Huawei'],
    tags:         ['国内大厂', 'ICT', '制造业', '通信', '世界500强'],
  },
  {
    company_name: '网易',
    aliases:      ['NetEase', '163'],
    tags:         ['国内大厂', '互联网大厂', '游戏', '教育'],
  },
  {
    company_name: '小米',
    aliases:      ['Xiaomi', 'MIUI'],
    tags:         ['国内大厂', '互联网大厂', '硬件', '消费电子'],
  },
  {
    company_name: '滴滴',
    aliases:      ['DiDi', '滴滴出行', '滴滴打车'],
    tags:         ['国内大厂', '互联网大厂', '出行'],
  },
  {
    company_name: '拼多多',
    aliases:      ['PDD', 'Pinduoduo', 'Temu'],
    tags:         ['国内大厂', '互联网大厂', '电商'],
  },
  {
    company_name: '快手',
    aliases:      ['Kuaishou', 'KS'],
    tags:         ['国内大厂', '互联网大厂', '短视频', '内容平台'],
  },
  {
    company_name: 'bilibili',
    aliases:      ['B站', 'Bilibili', 'bili'],
    tags:         ['国内大厂', '互联网大厂', '视频', '内容平台'],
  },
  {
    company_name: '360',
    aliases:      ['奇虎360', 'Qihoo 360'],
    tags:         ['国内大厂', '互联网大厂', '安全'],
  },
  {
    company_name: '携程',
    aliases:      ['Ctrip', 'Trip.com'],
    tags:         ['国内大厂', '互联网大厂', '旅游', 'OTA'],
  },
  {
    company_name: '58同城',
    aliases:      ['58', 'Wuba'],
    tags:         ['国内大厂', '互联网大厂', '分类信息'],
  },
  {
    company_name: '贝壳',
    aliases:      ['链家', 'KE Holdings', '贝壳找房'],
    tags:         ['国内大厂', '互联网大厂', '房产'],
  },
  {
    company_name: '微博',
    aliases:      ['Weibo', '新浪微博', '新浪'],
    tags:         ['国内大厂', '互联网大厂', '社交', '媒体'],
  },
  {
    company_name: '饿了么',
    aliases:      ['Ele.me'],
    tags:         ['国内大厂', '互联网大厂', '本地生活', '外卖'],
  },
  {
    company_name: '虎牙',
    aliases:      ['Huya'],
    tags:         ['互联网', '直播', '游戏'],
  },
  {
    company_name: '斗鱼',
    aliases:      ['DouYu'],
    tags:         ['互联网', '直播', '游戏'],
  },
  {
    company_name: 'Shopee',
    aliases:      ['虾皮', 'shopee'],
    tags:         ['互联网', '电商', '东南亚'],
  },

  // ── 国内金融 ──────────────────────────────────────────────────
  {
    company_name: '中国平安',
    aliases:      ['平安', '平安保险', '平安银行', 'Ping An'],
    tags:         ['金融', '保险', '著名企业'],
  },
  {
    company_name: '招商银行',
    aliases:      ['招行', 'CMB'],
    tags:         ['金融', '银行', '著名企业'],
  },
  {
    company_name: '中国工商银行',
    aliases:      ['工行', 'ICBC'],
    tags:         ['金融', '银行', '著名企业', '国企'],
  },
  {
    company_name: '中国建设银行',
    aliases:      ['建行', 'CCB'],
    tags:         ['金融', '银行', '著名企业', '国企'],
  },
  {
    company_name: '中国农业银行',
    aliases:      ['农行', 'ABC'],
    tags:         ['金融', '银行', '著名企业', '国企'],
  },
  {
    company_name: '中国银行',
    aliases:      ['中行', 'BOC'],
    tags:         ['金融', '银行', '著名企业', '国企'],
  },
  {
    company_name: '中信证券',
    aliases:      ['中信', 'CITIC Securities'],
    tags:         ['金融', '证券', '著名企业'],
  },
  {
    company_name: '蚂蚁集团',
    aliases:      ['蚂蚁金服', 'Ant Group', '支付宝'],
    tags:         ['金融科技', '互联网大厂', '国内大厂'],
  },

  // ── 国内通信 / 运营商 ─────────────────────────────────────────
  {
    company_name: '中国移动',
    aliases:      ['移动', 'China Mobile'],
    tags:         ['通信', '运营商', '著名企业', '国企'],
  },
  {
    company_name: '中国联通',
    aliases:      ['联通', 'China Unicom'],
    tags:         ['通信', '运营商', '著名企业', '国企'],
  },
  {
    company_name: '中国电信',
    aliases:      ['电信', 'China Telecom'],
    tags:         ['通信', '运营商', '著名企业', '国企'],
  },
  {
    company_name: '中兴通讯',
    aliases:      ['中兴', 'ZTE'],
    tags:         ['通信', 'ICT', '著名企业'],
  },

  // ── 国内硬件 / 制造 ───────────────────────────────────────────
  {
    company_name: '联想',
    aliases:      ['Lenovo'],
    tags:         ['硬件', '制造业', '著名企业', 'PC'],
  },
  {
    company_name: '比亚迪',
    aliases:      ['BYD'],
    tags:         ['汽车', '新能源', '制造业', '著名企业'],
  },
  {
    company_name: '宁德时代',
    aliases:      ['CATL'],
    tags:         ['新能源', '制造业', '著名企业'],
  },
  {
    company_name: '吉利汽车',
    aliases:      ['吉利', 'Geely'],
    tags:         ['汽车', '制造业', '著名企业'],
  },
  {
    company_name: '海尔',
    aliases:      ['Haier'],
    tags:         ['家电', '制造业', '著名企业'],
  },
  {
    company_name: '格力',
    aliases:      ['格力电器', 'Gree'],
    tags:         ['家电', '制造业', '著名企业'],
  },
  {
    company_name: '美的',
    aliases:      ['美的集团', 'Midea'],
    tags:         ['家电', '制造业', '著名企业'],
  },
  {
    company_name: '大疆',
    aliases:      ['DJI'],
    tags:         ['硬件', '无人机', '制造业', '著名企业'],
  },
  {
    company_name: 'OPPO',
    aliases:      ['欧珀', 'OnePlus', '一加'],
    tags:         ['硬件', '消费电子', '著名企业'],
  },
  {
    company_name: 'vivo',
    aliases:      ['维沃'],
    tags:         ['硬件', '消费电子', '著名企业'],
  },

  // ── 国内其他著名企业 ──────────────────────────────────────────
  {
    company_name: '用友',
    aliases:      ['用友网络', 'Yonyou'],
    tags:         ['企业软件', 'ERP', '著名企业'],
  },
  {
    company_name: '金蝶',
    aliases:      ['金蝶国际', 'Kingdee'],
    tags:         ['企业软件', 'ERP', '著名企业'],
  },
  {
    company_name: '科大讯飞',
    aliases:      ['讯飞', 'iFLYTEK'],
    tags:         ['AI', '语音识别', '著名企业'],
  },
  {
    company_name: '商汤科技',
    aliases:      ['商汤', 'SenseTime'],
    tags:         ['AI', '计算机视觉', '著名企业'],
  },
  {
    company_name: '旷视科技',
    aliases:      ['旷视', 'Megvii', 'Face++'],
    tags:         ['AI', '计算机视觉', '著名企业'],
  },
  {
    company_name: '海康威视',
    aliases:      ['海康', 'Hikvision'],
    tags:         ['安防', '硬件', '著名企业'],
  },

  // ── 外企：互联网 / 科技 ───────────────────────────────────────
  {
    company_name: 'Google',
    aliases:      ['谷歌', 'Alphabet', 'YouTube', 'DeepMind'],
    tags:         ['外企', '互联网', '科技', '世界500强'],
  },
  {
    company_name: 'Microsoft',
    aliases:      ['微软', 'MS', 'Azure', 'LinkedIn'],
    tags:         ['外企', '科技', '软件', '世界500强'],
  },
  {
    company_name: '微软中国',
    aliases:      ['Microsoft China', '微软（中国）'],
    tags:         ['外企', '世界500强', '软件', '科技'],
  },
  {
    company_name: 'Apple',
    aliases:      ['苹果', 'Apple Inc'],
    tags:         ['外企', '科技', '消费电子', '世界500强'],
  },
  {
    company_name: 'Amazon',
    aliases:      ['亚马逊', 'AWS', 'Amazon Web Services'],
    tags:         ['外企', '互联网', '电商', '云计算', '世界500强'],
  },
  {
    company_name: 'Meta',
    aliases:      ['Facebook', 'Instagram', 'WhatsApp'],
    tags:         ['外企', '互联网', '社交'],
  },
  {
    company_name: 'Netflix',
    aliases:      ['奈飞'],
    tags:         ['外企', '互联网', '流媒体'],
  },
  {
    company_name: 'Twitter',
    aliases:      ['X', 'X.com'],
    tags:         ['外企', '互联网', '社交'],
  },
  {
    company_name: 'Uber',
    aliases:      ['优步'],
    tags:         ['外企', '互联网', '出行'],
  },
  {
    company_name: 'Airbnb',
    aliases:      ['爱彼迎'],
    tags:         ['外企', '互联网', '旅游'],
  },

  // ── 外企：芯片 / 半导体 ───────────────────────────────────────
  {
    company_name: 'Intel',
    aliases:      ['英特尔'],
    tags:         ['外企', '芯片', '半导体', '世界500强'],
  },
  {
    company_name: 'Qualcomm',
    aliases:      ['高通'],
    tags:         ['外企', '芯片', '半导体', '通信'],
  },
  {
    company_name: 'NVIDIA',
    aliases:      ['英伟达'],
    tags:         ['外企', '芯片', 'GPU', 'AI'],
  },
  {
    company_name: 'AMD',
    aliases:      ['超威半导体'],
    tags:         ['外企', '芯片', '半导体'],
  },
  {
    company_name: 'ARM',
    aliases:      ['安谋'],
    tags:         ['外企', '芯片', '半导体'],
  },
  {
    company_name: 'TSMC',
    aliases:      ['台积电'],
    tags:         ['外企', '芯片', '半导体', '制造业'],
  },
  {
    company_name: 'Samsung',
    aliases:      ['三星', 'Samsung Electronics'],
    tags:         ['外企', '消费电子', '芯片', '世界500强'],
  },

  // ── 外企：企业软件 / 云计算 ───────────────────────────────────
  {
    company_name: 'IBM',
    aliases:      ['国际商业机器'],
    tags:         ['外企', '科技', '企业软件', '世界500强'],
  },
  {
    company_name: 'Oracle',
    aliases:      ['甲骨文'],
    tags:         ['外企', '数据库', '企业软件', '世界500强'],
  },
  {
    company_name: 'SAP',
    aliases:      ['思爱普'],
    tags:         ['外企', 'ERP', '企业软件', '世界500强'],
  },
  {
    company_name: 'Salesforce',
    aliases:      [],
    tags:         ['外企', 'CRM', '企业软件', 'SaaS'],
  },
  {
    company_name: 'VMware',
    aliases:      ['威睿'],
    tags:         ['外企', '虚拟化', '企业软件'],
  },
  {
    company_name: 'Cisco',
    aliases:      ['思科'],
    tags:         ['外企', '网络', '硬件', '世界500强'],
  },
  {
    company_name: 'Adobe',
    aliases:      ['奥多比'],
    tags:         ['外企', '软件', '创意'],
  },

  // ── 外企：咨询 / 审计 ─────────────────────────────────────────
  {
    company_name: 'Accenture',
    aliases:      ['埃森哲'],
    tags:         ['外企', '咨询', 'IT咨询', '世界500强'],
  },
  {
    company_name: 'McKinsey',
    aliases:      ['麦肯锡', 'McKinsey & Company'],
    tags:         ['外企', '咨询', '管理咨询'],
  },
  {
    company_name: 'Deloitte',
    aliases:      ['德勤'],
    tags:         ['外企', '咨询', '四大', '审计'],
  },
  {
    company_name: 'PwC',
    aliases:      ['普华永道', 'PricewaterhouseCoopers'],
    tags:         ['外企', '咨询', '四大', '审计'],
  },
  {
    company_name: 'EY',
    aliases:      ['安永', 'Ernst & Young'],
    tags:         ['外企', '咨询', '四大', '审计'],
  },
  {
    company_name: 'KPMG',
    aliases:      ['毕马威'],
    tags:         ['外企', '咨询', '四大', '审计'],
  },
  {
    company_name: 'BCG',
    aliases:      ['波士顿咨询', 'Boston Consulting Group'],
    tags:         ['外企', '咨询', '管理咨询'],
  },
  {
    company_name: 'Bain',
    aliases:      ['贝恩咨询', 'Bain & Company'],
    tags:         ['外企', '咨询', '管理咨询'],
  },

  // ── 外企：金融 ────────────────────────────────────────────────
  {
    company_name: 'HSBC',
    aliases:      ['汇丰银行', '汇丰'],
    tags:         ['外企', '金融', '银行', '世界500强'],
  },
  {
    company_name: 'JPMorgan',
    aliases:      ['摩根大通', 'JP Morgan', 'JPMorgan Chase'],
    tags:         ['外企', '金融', '投行', '世界500强'],
  },
  {
    company_name: 'Goldman Sachs',
    aliases:      ['高盛'],
    tags:         ['外企', '金融', '投行'],
  },
  {
    company_name: 'Morgan Stanley',
    aliases:      ['摩根士丹利'],
    tags:         ['外企', '金融', '投行'],
  },
  {
    company_name: 'Citibank',
    aliases:      ['花旗银行', '花旗', 'Citi'],
    tags:         ['外企', '金融', '银行', '世界500强'],
  },
  {
    company_name: 'UBS',
    aliases:      ['瑞银'],
    tags:         ['外企', '金融', '投行'],
  },

  // ── 外企：汽车 ────────────────────────────────────────────────
  {
    company_name: 'Tesla',
    aliases:      ['特斯拉'],
    tags:         ['外企', '汽车', '新能源', '世界500强'],
  },
  {
    company_name: 'BMW',
    aliases:      ['宝马', 'Bayerische Motoren Werke'],
    tags:         ['外企', '汽车', '世界500强'],
  },
  {
    company_name: 'Mercedes-Benz',
    aliases:      ['奔驰', '梅赛德斯-奔驰'],
    tags:         ['外企', '汽车', '世界500强'],
  },
  {
    company_name: 'Volkswagen',
    aliases:      ['大众', '大众汽车'],
    tags:         ['外企', '汽车', '世界500强'],
  },
  {
    company_name: 'Toyota',
    aliases:      ['丰田'],
    tags:         ['外企', '汽车', '世界500强'],
  },
  {
    company_name: 'Bosch',
    aliases:      ['博世'],
    tags:         ['外企', '汽车零部件', '制造业', '世界500强'],
  },

  // ── 外企：工业 / 其他 ─────────────────────────────────────────
  {
    company_name: 'Siemens',
    aliases:      ['西门子'],
    tags:         ['外企', '工业', '制造业', '世界500强'],
  },
  {
    company_name: 'Philips',
    aliases:      ['飞利浦'],
    tags:         ['外企', '消费电子', '医疗'],
  },
  {
    company_name: 'Sony',
    aliases:      ['索尼'],
    tags:         ['外企', '消费电子', '游戏', '世界500强'],
  },
  {
    company_name: 'Panasonic',
    aliases:      ['松下'],
    tags:         ['外企', '消费电子', '制造业'],
  },
  {
    company_name: 'Honeywell',
    aliases:      ['霍尼韦尔'],
    tags:         ['外企', '工业', '制造业', '世界500强'],
  },
  {
    company_name: 'GE',
    aliases:      ['通用电气', 'General Electric'],
    tags:         ['外企', '工业', '制造业', '世界500强'],
  },
];

async function createCompanyTable() {
  await pool.query(CREATE_COMPANY_TABLE_SQL);
  console.log('Table company_dictionary is ready.');
}

async function upsertCompany(row) {
  const sql = `
    INSERT INTO company_dictionary
      (company_name, aliases, tags)
    VALUES
      ($1, $2, $3)
    ON CONFLICT (company_name) DO UPDATE SET
      aliases    = EXCLUDED.aliases,
      tags       = EXCLUDED.tags,
      updated_at = NOW();
  `;
  await pool.query(sql, [
    row.company_name,
    row.aliases,
    row.tags,
  ]);
}

async function seedCompanyDictionary() {
  for (const row of COMPANY_DICTIONARY_ROWS) {
    await upsertCompany(row);
    console.log(`  Upserted company: "${row.company_name}"`);
  }
}

async function verifyCompanySeedResult() {
  const countResult = await pool.query(
    `SELECT COUNT(*) AS total FROM company_dictionary;`
  );
  console.log(`\nTotal records in company_dictionary: ${countResult.rows[0].total}`);

  // 验证：国内大厂标签召回
  const tagResult = await pool.query(`
    SELECT company_name, aliases, tags
    FROM company_dictionary
    WHERE tags && ARRAY['国内大厂']::text[]
    ORDER BY company_name;
  `);
  console.log(`\n[Verification] Companies with tag '国内大厂': ${tagResult.rowCount}`);
  tagResult.rows.forEach(r => {
    console.log(`  ${r.company_name}  aliases: ${JSON.stringify(r.aliases)}  tags: ${JSON.stringify(r.tags)}`);
  });

  if (tagResult.rowCount < 7) {
    console.error(`  Verification FAILED: expected >= 7 companies with '国内大厂', got ${tagResult.rowCount}`);
  } else {
    console.log('  国内大厂 check: PASSED');
  }

  // 验证：世界500强标签召回
  const f500Result = await pool.query(`
    SELECT company_name, aliases, tags
    FROM company_dictionary
    WHERE tags && ARRAY['世界500强']::text[]
    ORDER BY company_name;
  `);
  console.log(`\nTotal companies with tag '世界500强': ${f500Result.rowCount}`);
  f500Result.rows.forEach(r => {
    console.log(`  ${r.company_name}  aliases: ${JSON.stringify(r.aliases)}  tags: ${JSON.stringify(r.tags)}`);
  });

  // 验证 Issue 01 要求的 8 家公司全部存在
  const required500 = ['华为', '微软中国', 'Amazon', 'IBM', 'Oracle', 'SAP', 'Siemens', 'Bosch'];
  const found500Names = f500Result.rows.map(r => r.company_name);
  const missing500 = required500.filter(name => !found500Names.includes(name));
  if (missing500.length > 0) {
    console.error(`  Verification FAILED: missing '世界500强' companies: ${missing500.join(', ')}`);
  } else {
    console.log('  世界500强 check: PASSED (all 8 required companies present)');
  }

  // 验证华为同时具备 国内大厂 和 世界500强
  const huaweiResult = await pool.query(`
    SELECT company_name, tags
    FROM company_dictionary
    WHERE company_name = '华为';
  `);
  if (huaweiResult.rowCount > 0) {
    const huaweiTags = huaweiResult.rows[0].tags;
    const hasGuonei = huaweiTags.includes('国内大厂');
    const has500    = huaweiTags.includes('世界500强');
    if (hasGuonei && has500) {
      console.log('  华为 dual-tag check: PASSED (国内大厂 + 世界500强)');
    } else {
      console.error(`  Verification FAILED: 华为 tags = ${JSON.stringify(huaweiTags)}, expected both '国内大厂' and '世界500强'`);
    }
  }
}

// ════════════════════════════════════════════════════════════════════
// 主流程
// ════════════════════════════════════════════════════════════════════
async function main() {
  try {
    await ensureDatabaseExists();

    console.log(`Connecting to PostgreSQL database: ${DB_NAME}`);

    // ── 技能字典 ──
    await createSkillTable();
    await seedSkillDictionary();
    await verifySkillSeedResult();
    console.log('\nskill_dictionary seeded successfully.');

    // ── 公司字典 ──
    console.log('\n────────────────────────────────────────');
    await createCompanyTable();
    await seedCompanyDictionary();
    await verifyCompanySeedResult();
    console.log('\ncompany_dictionary seeded successfully.');

  } catch (error) {
    console.error('Failed to seed dictionaries:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();