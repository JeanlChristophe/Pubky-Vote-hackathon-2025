const crypto = require('crypto');

const DEFAULT_MODEL = process.env.AI_JUDGE_MODEL || 'gpt-4.1-mini';
const API_URL = process.env.AI_JUDGE_API_URL;
const API_KEY = process.env.AI_JUDGE_API_KEY || process.env.OPENAI_API_KEY || '';

function clampScore(value) {
  if (Number.isNaN(value)) {
    return null;
  }
  if (value < 0) return 0;
  if (value > 100) return 100;
  return Math.round(value);
}

function hashString(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex');
}

function simulatedEvaluation(project) {
  const summary = project.summary || project.description || '';
  const seed = `${project.id}:${summary}:${(project.tags || []).join(',')}`;
  const hash = hashString(seed);
  const numeric = parseInt(hash.slice(0, 8), 16);
  const score = 60 + (numeric % 41); // 60-100 inclusive
  const highlightTag = (project.tags || [])[numeric % (project.tags?.length || 1)] || 'innovation';
  const reasoningParts = [
    `Focuses on ${highlightTag} with a clear Pubky narrative.`,
  ];
  if (summary.length > 280) {
    reasoningParts.push('Detailed summary suggests well-defined scope.');
  } else if (summary.length < 120) {
    reasoningParts.push('Concise overview leaves some room for elaboration.');
  }
  const reasoning = reasoningParts.join(' ');

  return {
    score: clampScore(score),
    reasoning,
    model: 'gpt-judge-sim',
    source: 'simulation',
    simulated: true,
    lastEvaluatedAt: new Date().toISOString(),
  };
}

async function callJudgeApi(project) {
  if (!API_URL || !API_KEY || typeof fetch !== 'function') {
    return null;
  }

  const summary = project.summary || project.description || '';
  if (!summary) {
    throw new Error('Project is missing a summary for the AI judge.');
  }

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        input: `Rate the following Pubky hackathon project from 0-100 and explain the reasoning in 2 sentences. Project summary: ${summary}`,
      }),
    });

    if (!response.ok) {
      throw new Error(`AI judge API responded with status ${response.status}`);
    }

    const data = await response.json();
    const scoreValue = clampScore(Number(data?.score ?? data?.result?.score));
    const reasoning = data?.reasoning || data?.result?.reasoning || data?.message;

    if (scoreValue === null || !reasoning) {
      throw new Error('AI judge API returned an unexpected payload.');
    }

    return {
      score: scoreValue,
      reasoning,
      model: data?.model || DEFAULT_MODEL,
      source: 'api',
      simulated: false,
      lastEvaluatedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.warn('AI judge API call failed, falling back to simulation:', error.message);
    return null;
  }
}

async function evaluateProject(project) {
  const apiResult = await callJudgeApi(project);
  if (apiResult) {
    return apiResult;
  }
  return simulatedEvaluation(project);
}

module.exports = {
  evaluateProject,
};
