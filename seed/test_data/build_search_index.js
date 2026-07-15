const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.PGHOST || 'scnu0010.ux.festo.net',
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || 'resume',
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
});

async function createIndexTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS candidate_search_index (
      user_id VARCHAR(64) PRIMARY KEY,
      name VARCHAR(64) NOT NULL,
      birthdate DATE NOT NULL,
      gender VARCHAR(10) NOT NULL,
      aim_salary VARCHAR(32),
      applied_at TIMESTAMP,
      full_text TEXT,
      matched_skills TEXT[] NOT NULL DEFAULT '{}',
      matched_companies TEXT[] NOT NULL DEFAULT '{}',
      company_tags TEXT[] NOT NULL DEFAULT '{}',
      latest_company VARCHAR(200),
      latest_title VARCHAR(200),
      experience_count INT DEFAULT 0,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_candidate_search_index_gender 
    ON candidate_search_index(gender);

    CREATE INDEX IF NOT EXISTS idx_candidate_search_index_birthdate 
    ON candidate_search_index(birthdate);

    CREATE INDEX IF NOT EXISTS idx_candidate_search_index_skills 
    ON candidate_search_index USING GIN(matched_skills);

    CREATE INDEX IF NOT EXISTS idx_candidate_search_index_company_tags 
    ON candidate_search_index USING GIN(company_tags);

    CREATE INDEX IF NOT EXISTS idx_candidate_search_index_full_text 
    ON candidate_search_index USING GIN(to_tsvector('simple', full_text));
  `);
}

async function loadSkillDictionary() {
  const result = await pool.query(`
    SELECT skill_name, aliases, related_terms
    FROM skill_dictionary
  `);

  return result.rows.map(row => ({
    skillName: row.skill_name,
    terms: unique([
      row.skill_name,
      ...(row.aliases || []),
      ...(row.related_terms || [])
    ])
  }));
}

async function loadCompanyDictionary() {
  const result = await pool.query(`
    SELECT company_name, aliases, tags
    FROM company_dictionary
  `);

  return result.rows.map(row => ({
    companyName: row.company_name,
    terms: unique([
      row.company_name,
      ...(row.aliases || [])
    ]),
    tags: row.tags || []
  }));
}

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

function buildFullText(resume, experiences) {
  const parts = [
    resume.name,
    resume.gender,
    resume.aim_salary,
    resume.personal,
    ...experiences.flatMap(exp => [
      exp.company,
      exp.title,
      exp.summary,
      exp.startDate,
      exp.endDate
    ])
  ];

  return parts.filter(Boolean).join('\n');
}

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

function findMatchedCompanies(fullText, companyDict) {
  const matchedCompanies = [];
  const companyTags = [];

  for (const company of companyDict) {
    const hit = company.terms.some(term => includesTerm(fullText, term));
    if (hit) {
      matchedCompanies.push(company.companyName);
      companyTags.push(...company.tags);
    }
  }

  return {
    matchedCompanies: unique(matchedCompanies),
    companyTags: unique(companyTags)
  };
}

function getLatestExperience(experiences) {
  if (!experiences.length) {
    return null;
  }

  const sorted = [...experiences].sort((a, b) => {
    const aEnd = a.endDate === '至今' ? '9999-12-31' : a.endDate || '0000-01-01';
    const bEnd = b.endDate === '至今' ? '9999-12-31' : b.endDate || '0000-01-01';
    return bEnd.localeCompare(aEnd);
  });

  return sorted[0];
}

async function upsertCandidateIndex(indexRow) {
  await pool.query(
    `
    INSERT INTO candidate_search_index (
      user_id,
      name,
      birthdate,
      gender,
      aim_salary,
      applied_at,
      full_text,
      matched_skills,
      matched_companies,
      company_tags,
      latest_company,
      latest_title,
      experience_count,
      updated_at
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW()
    )
    ON CONFLICT (user_id)
    DO UPDATE SET
      name = EXCLUDED.name,
      birthdate = EXCLUDED.birthdate,
      gender = EXCLUDED.gender,
      aim_salary = EXCLUDED.aim_salary,
      applied_at = EXCLUDED.applied_at,
      full_text = EXCLUDED.full_text,
      matched_skills = EXCLUDED.matched_skills,
      matched_companies = EXCLUDED.matched_companies,
      company_tags = EXCLUDED.company_tags,
      latest_company = EXCLUDED.latest_company,
      latest_title = EXCLUDED.latest_title,
      experience_count = EXCLUDED.experience_count,
      updated_at = NOW();
    `,
    [
      indexRow.user_id,
      indexRow.name,
      indexRow.birthdate,
      indexRow.gender,
      indexRow.aim_salary,
      indexRow.applied_at,
      indexRow.full_text,
      indexRow.matched_skills,
      indexRow.matched_companies,
      indexRow.company_tags,
      indexRow.latest_company,
      indexRow.latest_title,
      indexRow.experience_count
    ]
  );
}

async function main() {
  try {
    await createIndexTable();

    const skillDict = await loadSkillDictionary();
    const companyDict = await loadCompanyDictionary();

    const result = await pool.query(`
      SELECT 
        user_id,
        name,
        birthdate,
        gender,
        aim_salary,
        personal,
        applied_at,
        experience_if
      FROM candidate_resumes
      ORDER BY user_id
    `);

    console.log(`Loaded ${result.rowCount} resumes.`);

    let count = 0;

    for (const resume of result.rows) {
      const experiences = safeParseExperience(resume.experience_if);
      const fullText = buildFullText(resume, experiences);

      const matchedSkills = findMatchedSkills(fullText, skillDict);
      const {
        matchedCompanies,
        companyTags
      } = findMatchedCompanies(fullText, companyDict);

      const latestExperience = getLatestExperience(experiences);

      await upsertCandidateIndex({
        user_id: resume.user_id,
        name: resume.name,
        birthdate: resume.birthdate,
        gender: resume.gender,
        aim_salary: resume.aim_salary,
        applied_at: resume.applied_at,
        full_text: fullText,
        matched_skills: matchedSkills,
        matched_companies: matchedCompanies,
        company_tags: companyTags,
        latest_company: latestExperience ? latestExperience.company : null,
        latest_title: latestExperience ? latestExperience.title : null,
        experience_count: experiences.length
      });

      count++;

      if (count % 50 === 0) {
        console.log(`Indexed ${count}/${result.rowCount}`);
      }
    }

    console.log(`Done. Indexed ${count} resumes.`);
  } catch (error) {
    console.error('Failed to build search index:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();