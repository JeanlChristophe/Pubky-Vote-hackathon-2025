const projectContainer = document.querySelector('#projects');
const template = document.querySelector('#project-template');
const filterInput = document.querySelector('#filterInput');
const identityStatus = document.querySelector('#identityStatus');
const identityHint = document.querySelector('#identityHint');
const connectButton = document.querySelector('#connectPubkyRing');
const disconnectButton = document.querySelector('#disconnectPubkyRing');
const aiJudgeList = document.querySelector('#aiJudgePanelList');
const aiJudgeStatus = document.querySelector('#aiJudgePanelStatus');
const runAiJudgeAllButton = document.querySelector('#runAiJudgeAll');

const identityHintDefaultText = identityHint?.textContent || '';

const STORAGE_KEY = 'pubky-ring-identity';
const RING_APP_NAME = 'Pubky Hackathon Voting';

function pushUnique(target, value) {
  if (!Array.isArray(target) || typeof value !== 'string') {
    return;
  }
  if (!value || target.includes(value)) {
    return;
  }
  target.push(value);
}

const baseRingRequests = [];

[
  connectButton?.dataset.request,
  window.PUBKY_RING_REQUEST,
  'pubky://pubkyhackathon/vote'
].forEach((value) => {
  if (typeof value !== 'string') {
    return;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return;
  }
  pushUnique(baseRingRequests, trimmed);
});

const ringRequests = [];

baseRingRequests.forEach((request) => {
  pushUnique(ringRequests, request);

  if (request.includes('://')) {
    return;
  }

  const normalized = request.replace(/^\/+/, '');
  if (normalized) {
    pushUnique(ringRequests, `pubky://${normalized}`);
  }

  if (request.startsWith('pubky')) {
    const truncated = request.slice('pubky'.length).replace(/^\/+/, '');
    if (truncated) {
      pushUnique(ringRequests, `pubky://${truncated}`);
    }
  }
});

const TAG_COLOR_CLASSES = ['tag-pill--plum', 'tag-pill--teal', 'tag-pill--amber', 'tag-pill--rose', 'tag-pill--blue', 'tag-pill--mint'];

let identity = null;

let projects = [];
let activeFilter = '';
let lastRingError = null;
let invalidRingRequest = false;

function hashString(input = '') {
  let hash = 0;
  const stringified = String(input);
  for (let i = 0; i < stringified.length; i += 1) {
    hash = (hash << 5) - hash + stringified.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

function colorClassForTag(tag) {
  if (!tag) {
    return TAG_COLOR_CLASSES[0];
  }
  const hash = Math.abs(hashString(tag));
  return TAG_COLOR_CLASSES[hash % TAG_COLOR_CLASSES.length];
}

function gradientFor(seed) {
  if (!seed) {
    return 'linear-gradient(135deg, rgba(140, 84, 255, 0.85), rgba(77, 231, 198, 0.75))';
  }
  const baseHue = (Math.abs(hashString(seed)) % 360 + 360) % 360;
  const secondHue = (baseHue + 45) % 360;
  return `linear-gradient(135deg, hsl(${baseHue} 80% 62%), hsl(${secondHue} 74% 56%))`;
}

function initialsFromTeam(team = '') {
  const trimmed = team.trim();
  if (!trimmed) {
    return 'PK';
  }
  const parts = trimmed.split(/\s+/).filter(Boolean);
  const initials = parts.slice(0, 2).map((part) => part[0].toUpperCase());
  return initials.join('');
}

async function fetchProjects() {
  const response = await fetch('/api/projects');
  if (!response.ok) {
    throw new Error('Failed to load projects');
  }
  projects = await response.json();
  projects.sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name));
  renderProjects();
}

function matchFilter(project, filter) {
  if (!filter) return true;
  const haystack = [
    project.name,
    project.team,
    ...(project.tags || [])
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(filter.toLowerCase());
}

function truncateReasoning(text, maxLength = 220) {
  if (!text) return '';
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1)}…`;
}

function formatAiJudgeMeta(aiJudge) {
  if (!aiJudge || !aiJudge.lastEvaluatedAt) {
    return 'Not yet scored by the AI judge.';
  }
  const timestamp = new Date(aiJudge.lastEvaluatedAt);
  if (Number.isNaN(timestamp.getTime())) {
    return 'AI judge timestamp unavailable.';
  }
  const formatter = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  });
  const mode = aiJudge.simulated ? 'Simulated score' : 'Live score';
  const modelSegment = aiJudge.model ? ` · ${aiJudge.model}` : '';
  return `${mode}${modelSegment} on ${formatter.format(timestamp)}.`;
}

function renderProjects() {
  projectContainer.innerHTML = '';
  const fragment = document.createDocumentFragment();

  projects.filter((project) => matchFilter(project, activeFilter)).forEach((project) => {
    const node = template.content.cloneNode(true);

    const avatarEl = node.querySelector('.project-card__avatar');
    if (avatarEl) {
      avatarEl.textContent = initialsFromTeam(project.team || project.name);
      avatarEl.style.setProperty('--avatar-gradient', gradientFor(`${project.id}:${project.team}`));
    }

    node.querySelector('.project-card__title').textContent = project.name;
    node.querySelector('.project-card__team').textContent = project.team ? `Team ${project.team}` : 'Solo builder';
    node.querySelector('.project-card__description').textContent = project.description;

    const votesEl = node.querySelector('.project-card__votes');
    votesEl.textContent = String(project.votes ?? 0);
    votesEl.setAttribute('aria-label', `${project.votes ?? 0} vote${project.votes === 1 ? '' : 's'}`);

    const statusEl = node.querySelector('.project-card__status');
    const voteButton = node.querySelector('.project-card__vote-button');
    voteButton.addEventListener('click', () => handleVote(project.id, statusEl));

    const tagContainer = node.querySelector('.project-card__tags');
    (project.tags || []).forEach((tag) => {
      const tagEl = document.createElement('button');
      tagEl.className = `tag-pill ${colorClassForTag(tag)}`;
      tagEl.type = 'button';
      tagEl.textContent = tag.toUpperCase();
      if (activeFilter && activeFilter.toLowerCase() === tag.toLowerCase()) {
        tagEl.classList.add('tag-pill--active');
      }
      tagEl.addEventListener('click', () => {
        activeFilter = tag;
        filterInput.value = tag;
        renderProjects();
      });
      tagContainer.appendChild(tagEl);
    });

    const aiJudgeButton = node.querySelector('.project-card__ai-judge-button');
    const aiScoreEl = node.querySelector('.project-card__ai-score');
    const aiReasoningEl = node.querySelector('.project-card__ai-reasoning');
    const aiMetaEl = node.querySelector('.project-card__ai-meta');
    const aiJudgeData = project.aiJudge && typeof project.aiJudge === 'object' ? project.aiJudge : null;

    if (aiScoreEl) {
      aiScoreEl.textContent =
        aiJudgeData && typeof aiJudgeData.score === 'number' ? String(aiJudgeData.score) : '--';
    }

    if (aiReasoningEl) {
      aiReasoningEl.textContent =
        aiJudgeData && aiJudgeData.reasoning
          ? truncateReasoning(aiJudgeData.reasoning)
          : 'Run the AI judge to generate a Pubky score and summary.';
    }

    if (aiMetaEl) {
      aiMetaEl.textContent = formatAiJudgeMeta(aiJudgeData);
    }

    if (aiJudgeButton) {
      aiJudgeButton.addEventListener('click', () =>
        handleAiJudge(project, statusEl, {
          button: aiJudgeButton,
          scoreEl: aiScoreEl,
          reasoningEl: aiReasoningEl,
          metaEl: aiMetaEl
        })
      );
    }

    const feedbackButton = node.querySelector('.project-card__feedback-button');
    const feedbackForm = node.querySelector('.project-card__feedback-form');
    const feedbackTextarea = feedbackForm?.querySelector('textarea');
    const feedbackCancel = feedbackForm?.querySelector('.project-card__feedback-cancel');
    const feedbackSubmit = feedbackForm?.querySelector('.project-card__feedback-submit');
    const feedbackCount = Array.isArray(project.feedback) ? project.feedback.length : 0;
    const feedbackLabel = feedbackCount ? `Leave feedback (${feedbackCount})` : 'Leave feedback';

    if (feedbackButton && feedbackForm && feedbackTextarea) {
      feedbackButton.dataset.label = feedbackLabel;
      feedbackButton.dataset.fallbackLabel = 'Connect to comment';
      feedbackButton.textContent = identity ? feedbackLabel : feedbackButton.dataset.fallbackLabel;

      const toggleFeedback = (expanded) => {
        feedbackButton.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        feedbackForm.hidden = !expanded;
        if (expanded) {
          feedbackTextarea.focus();
        }
      };

      feedbackButton.addEventListener('click', () => {
        if (!identity) {
          statusEl.textContent = 'Connect your Pubky Ring identity before leaving feedback.';
          identityHint?.classList.add('identity-panel__hint--warn');
          return;
        }
        const isExpanded = feedbackButton.getAttribute('aria-expanded') === 'true';
        toggleFeedback(!isExpanded);
      });

      feedbackCancel?.addEventListener('click', (event) => {
        event.preventDefault();
        toggleFeedback(false);
      });

      feedbackForm.addEventListener('submit', (event) => {
        event.preventDefault();
        const message = feedbackTextarea.value.trim();
        if (!message) {
          statusEl.textContent = 'Feedback cannot be empty.';
          return;
        }
        handleFeedback(project.id, message, {
          statusEl,
          toggleFeedback,
          feedbackForm,
          feedbackTextarea,
          feedbackButton,
          feedbackSubmit
        });
      });
    }

    const linkContainer = node.querySelector('.project-card__links');
    if (project.links) {
      if (project.links.demo) {
        const demoLink = document.createElement('a');
        demoLink.href = project.links.demo;
        demoLink.target = '_blank';
        demoLink.rel = 'noopener noreferrer';
        demoLink.textContent = 'Live Demo ↗';
        linkContainer.appendChild(demoLink);
      }
      if (project.links.repo) {
        const repoLink = document.createElement('a');
        repoLink.href = project.links.repo;
        repoLink.target = '_blank';
        repoLink.rel = 'noopener noreferrer';
        repoLink.textContent = 'Source ↗';
        linkContainer.appendChild(repoLink);
      }
    }

    const tagForm = node.querySelector('.project-card__tag-form');
    tagForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const formData = new FormData(tagForm);
      const newTag = formData.get('tag');
      if (!newTag) return;
      handleTag(project.id, newTag, tagForm, statusEl);
    });

    fragment.appendChild(node);
  });

  projectContainer.appendChild(fragment);
  updateVoteButtons();
  updateAiJudgePanel();
}

function updateAiJudgePanel() {
  if (!aiJudgeList) {
    return;
  }

  aiJudgeList.innerHTML = '';
  const scoredProjects = projects
    .filter((project) => project.aiJudge && typeof project.aiJudge.score === 'number')
    .sort((a, b) => {
      const scoreDelta = (b.aiJudge?.score ?? -Infinity) - (a.aiJudge?.score ?? -Infinity);
      if (scoreDelta !== 0) {
        return scoreDelta;
      }
      const voteDelta = (b.votes ?? 0) - (a.votes ?? 0);
      if (voteDelta !== 0) {
        return voteDelta;
      }
      return a.name.localeCompare(b.name);
    });

  if (!scoredProjects.length) {
    const emptyItem = document.createElement('li');
    emptyItem.className = 'ai-judge-panel__empty';
    emptyItem.textContent = 'No AI scores yet. Run the judge to simulate ChatGPT scoring.';
    aiJudgeList.appendChild(emptyItem);
    return;
  }

  scoredProjects.slice(0, 5).forEach((project) => {
    const item = document.createElement('li');
    item.className = 'ai-judge-panel__item';

    const scoreEl = document.createElement('span');
    scoreEl.className = 'ai-judge-panel__score';
    scoreEl.textContent = String(project.aiJudge.score);

    const nameEl = document.createElement('span');
    nameEl.className = 'ai-judge-panel__project';
    nameEl.textContent = project.name;

    item.appendChild(scoreEl);
    item.appendChild(nameEl);
    aiJudgeList.appendChild(item);
  });
}

async function handleVote(projectId, statusEl) {
  if (!identity) {
    statusEl.textContent = 'Connect your Pubky Ring identity before voting.';
    identityHint?.classList.add('identity-panel__hint--warn');
    return;
  }

  statusEl.textContent = 'Submitting vote…';
  try {
    const payload = {
      pubkey: identity.pubkey
    };

    if (identity.proof) {
      payload.proof = identity.proof;
    }

    if (identity.session) {
      payload.session = identity.session;
    }

    const response = await fetch(`/api/projects/${projectId}/vote`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: 'Vote failed' }));
      statusEl.textContent = errorData.message || 'Vote failed.';
      return;
    }
    await fetchProjects();
    statusEl.textContent = 'Vote counted!';
  } catch (error) {
    console.error(error);
    statusEl.textContent = 'Unable to record vote. Try again.';
  }
}

async function handleTag(projectId, tag, form, statusEl) {
  statusEl.textContent = 'Adding tag…';
  try {
    const response = await fetch(`/api/projects/${projectId}/tags`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ tag })
    });
    if (!response.ok) {
      throw new Error('Unable to add tag');
    }
    form.reset();
    await fetchProjects();
    statusEl.textContent = `Tag "${tag}" added.`;
  } catch (error) {
    console.error(error);
    statusEl.textContent = 'Could not add tag.';
  }
}

async function handleFeedback(projectId, message, controls) {
  const {
    statusEl,
    toggleFeedback,
    feedbackForm,
    feedbackTextarea,
    feedbackButton,
    feedbackSubmit
  } = controls;

  if (!identity) {
    statusEl.textContent = 'Connect your Pubky Ring identity before leaving feedback.';
    identityHint?.classList.add('identity-panel__hint--warn');
    return;
  }

  const originalSubmitText = feedbackSubmit?.textContent;
  statusEl.textContent = 'Sending feedback…';
  feedbackButton.disabled = true;
  feedbackButton.setAttribute('aria-busy', 'true');
  if (feedbackSubmit) {
    feedbackSubmit.disabled = true;
    feedbackSubmit.textContent = 'Posting…';
  }

  try {
    const payload = {
      pubkey: identity.pubkey,
      message
    };

    if (identity.alias) {
      payload.alias = identity.alias;
    }

    if (identity.session) {
      payload.session = identity.session;
    }

    if (identity.proof) {
      payload.proof = identity.proof;
    }

    const response = await fetch(`/api/projects/${projectId}/feedback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: 'Failed to share feedback.' }));
      statusEl.textContent = errorData.message || 'Failed to share feedback.';
      return;
    }

    toggleFeedback(false);
    feedbackForm.reset();
    feedbackTextarea.blur();
    await fetchProjects();
    statusEl.textContent = 'Feedback shared!';
  } catch (error) {
    console.error(error);
    statusEl.textContent = 'Could not share feedback. Try again.';
  } finally {
    feedbackButton.disabled = false;
    feedbackButton.removeAttribute('aria-busy');
    if (feedbackSubmit) {
      feedbackSubmit.disabled = false;
      feedbackSubmit.textContent = originalSubmitText || 'Post feedback';
    }
  }
}

async function handleAiJudge(project, statusEl, controls) {
  const { button, scoreEl, reasoningEl, metaEl } = controls;
  const projectId = project.id;
  const originalLabel = button?.textContent;

  statusEl.textContent = 'Requesting AI judge score…';
  if (aiJudgeStatus) {
    aiJudgeStatus.classList.remove('ai-judge-panel__status--error');
    aiJudgeStatus.textContent = '';
  }

  if (button) {
    button.disabled = true;
    button.textContent = 'Scoring…';
    button.setAttribute('aria-busy', 'true');
  }

  try {
    const response = await fetch(`/api/projects/${projectId}/ai-judge`, {
      method: 'POST'
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: 'Unable to score project.' }));
      statusEl.textContent = errorData.message || 'Unable to score project.';
      return;
    }

    const data = await response.json();
    const aiJudgeResult = data.aiJudge || null;

    if (aiJudgeResult) {
      project.aiJudge = aiJudgeResult;
      statusEl.textContent = `AI judge score: ${
        typeof aiJudgeResult.score === 'number' ? aiJudgeResult.score : '—'
      }.`;
      if (aiJudgeStatus) {
        aiJudgeStatus.textContent = `${project.name} scored ${
          typeof aiJudgeResult.score === 'number' ? aiJudgeResult.score : '—'
        }.`;
      }

      if (scoreEl) {
        scoreEl.textContent =
          typeof aiJudgeResult.score === 'number' ? String(aiJudgeResult.score) : '--';
      }
      if (reasoningEl) {
        reasoningEl.textContent =
          aiJudgeResult.reasoning
            ? truncateReasoning(aiJudgeResult.reasoning)
            : 'AI judge did not return reasoning.';
      }
      if (metaEl) {
        metaEl.textContent = formatAiJudgeMeta(aiJudgeResult);
      }
      updateAiJudgePanel();
    } else {
      statusEl.textContent = 'AI judge score updated.';
    }
  } catch (error) {
    console.error(error);
    statusEl.textContent = 'AI judge request failed.';
    if (aiJudgeStatus) {
      aiJudgeStatus.textContent = 'AI judge request failed.';
      aiJudgeStatus.classList.add('ai-judge-panel__status--error');
    }
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalLabel || 'Re-score';
      button.removeAttribute('aria-busy');
    }
  }
}

async function scoreAllProjects() {
  if (!runAiJudgeAllButton) {
    return;
  }
  runAiJudgeAllButton.disabled = true;
  runAiJudgeAllButton.textContent = 'Scoring…';
  if (aiJudgeStatus) {
    aiJudgeStatus.classList.remove('ai-judge-panel__status--error');
    aiJudgeStatus.textContent = 'Scoring all projects with the AI judge…';
  }

  try {
    for (const project of projects) {
      const response = await fetch(`/api/projects/${project.id}/ai-judge`, { method: 'POST' });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Unable to score project.' }));
        throw new Error(errorData.message || 'Unable to score project.');
      }
      const data = await response.json();
      project.aiJudge = data.aiJudge || null;
      if (aiJudgeStatus) {
        aiJudgeStatus.textContent = `${project.name} scored ${
          typeof project.aiJudge?.score === 'number' ? project.aiJudge.score : '—'
        }.`;
      }
    }

    renderProjects();

    if (aiJudgeStatus) {
      aiJudgeStatus.textContent = 'AI judge scores refreshed for all projects.';
    }
  } catch (error) {
    console.error(error);
    if (aiJudgeStatus) {
      aiJudgeStatus.textContent = error.message || 'Failed to run AI judge on all projects.';
      aiJudgeStatus.classList.add('ai-judge-panel__status--error');
    }
  } finally {
    runAiJudgeAllButton.disabled = false;
    runAiJudgeAllButton.textContent = 'Score all projects';
  }
}

filterInput.addEventListener('input', (event) => {
  activeFilter = event.target.value.trim();
  renderProjects();
});

function shortenPubkey(pubkey) {
  if (!pubkey) return '';
  return pubkey.length <= 12 ? pubkey : `${pubkey.slice(0, 6)}…${pubkey.slice(-6)}`;
}

function normalizeIdentity(raw) {
  if (!raw) return null;
  const isObject = typeof raw === 'object' && raw !== null;
  const pubkey = typeof raw === 'string' ? raw : raw.pubkey || raw.publicKey || raw.key;
  if (!pubkey || typeof pubkey !== 'string') {
    return null;
  }
  const trimmed = pubkey.trim();
  if (!trimmed) {
    return null;
  }

  return {
    pubkey: trimmed,
    alias: isObject ? raw.alias || raw.displayName || raw.label || null : null,
    session: isObject ? raw.session || raw.sessionToken || null : null,
    proof: isObject ? raw.proof || raw.signature || null : null,
    source: isObject && raw.source ? raw.source : null
  };
}

function persistIdentity() {
  if (!identity) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }
  const payload = {
    pubkey: identity.pubkey,
    alias: identity.alias,
    session: identity.session,
    proof: identity.proof,
    source: identity.source || 'ring'
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function restoreIdentity() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return;
    const parsed = JSON.parse(stored);
    const normalized = normalizeIdentity(parsed);
    if (normalized) {
      normalized.source = parsed.source || 'ring';
      identity = normalized;
    }
  } catch (error) {
    console.warn('Failed to restore stored Pubky identity', error);
  }
}

function clearIdentity() {
  identity = null;
  localStorage.removeItem(STORAGE_KEY);
}

function resetIdentityHint() {
  if (!identityHint) {
    return;
  }
  if (identityHintDefaultText && identityHint.textContent !== identityHintDefaultText) {
    identityHint.textContent = identityHintDefaultText;
  }
}

function updateIdentityUI(message) {
  if (!identityStatus || !connectButton || !disconnectButton) {
    return;
  }

  if (!identity) {
    identityStatus.textContent = message || 'Not connected to Pubky Ring.';
    connectButton.textContent = 'Connect Pubky Ring';
    disconnectButton.hidden = true;
    identityHint?.classList.remove('identity-panel__hint--warn');
    resetIdentityHint();
  } else {
    const aliasSegment = identity.alias ? `${identity.alias} · ` : '';
    identityStatus.textContent = `Connected as ${aliasSegment}${shortenPubkey(identity.pubkey)}`;
    connectButton.textContent = 'Reconnect Pubky Ring';
    disconnectButton.hidden = false;
    identityHint?.classList.remove('identity-panel__hint--warn');
    resetIdentityHint();
  }
  connectButton.disabled = false;
  updateVoteButtons();
}

function updateVoteButtons() {
  const buttons = document.querySelectorAll('.project-card__vote-button');
  buttons.forEach((button) => {
    if (!identity) {
      button.disabled = true;
      button.setAttribute('aria-disabled', 'true');
      button.textContent = 'Connect to vote';
    } else {
      button.disabled = false;
      button.removeAttribute('aria-disabled');
      button.textContent = 'Vote';
    }
  });

  const feedbackButtons = document.querySelectorAll('.project-card__feedback-button');
  feedbackButtons.forEach((button) => {
    const label = button.dataset.label || 'Leave feedback';
    const fallbackLabel = button.dataset.fallbackLabel || 'Connect to comment';
    if (!identity) {
      button.disabled = true;
      button.setAttribute('aria-disabled', 'true');
      button.textContent = fallbackLabel;
      button.setAttribute('aria-expanded', 'false');
      const card = button.closest('.project-card');
      const form = card?.querySelector('.project-card__feedback-form');
      if (form) {
        form.hidden = true;
      }
    } else {
      button.disabled = false;
      button.removeAttribute('aria-disabled');
      button.textContent = label;
    }
  });
}

async function requestRingIdentity() {
  lastRingError = null;
  invalidRingRequest = false;

  const connectors = [
    typeof window.pubkyRing?.connect === 'function' ? window.pubkyRing.connect.bind(window.pubkyRing) : null,
    typeof window.PubkyRing?.connect === 'function' ? window.PubkyRing.connect.bind(window.PubkyRing) : null,
    typeof window.pubky?.ring?.connect === 'function' ? window.pubky.ring.connect.bind(window.pubky.ring) : null
  ].filter(Boolean);

  if (!connectors.length) {
    return null;
  }

  const attempts = ringRequests.length ? [...ringRequests] : [];

  const callConnector = async (connector, payload) => {
    try {
      const result = await connector(payload);
      if (result) {
        return result;
      }
    } catch (error) {
      lastRingError = error;
      const message = typeof error?.message === 'string' ? error.message : '';
      const isInvalidRequest = message.includes('Invalid request/URI');
      if (isInvalidRequest) {
        invalidRingRequest = true;
      } else if (payload) {
        console.warn('Pubky Ring connect rejected', payload, error);
      } else {
        console.warn('Pubky Ring connect rejected', error);
      }
    }
    return null;
  };

  for (const connector of connectors) {
    for (const request of attempts) {
      const response = await callConnector(connector, request);
      if (response) {
        return response;
      }

      const objectResponse = await callConnector(connector, { request, appName: RING_APP_NAME });
      if (objectResponse) {
        return objectResponse;
      }
    }

    const defaultResponse = await callConnector(connector, { appName: RING_APP_NAME });
    if (defaultResponse) {
      return defaultResponse;
    }
  }

  if (lastRingError) {
    console.warn('Falling back to manual Pubky key entry due to Pubky Ring errors:', lastRingError);
  }

  return null;
}

async function connectIdentity() {
  if (!connectButton) {
    return;
  }
  connectButton.disabled = true;
  if (identityStatus) {
    identityStatus.textContent = 'Connecting to Pubky Ring…';
  }
  try {
    const ringResponse = await requestRingIdentity();
    if (!ringResponse) {
      const manualPrompt = lastRingError?.message
        ? `Pubky Ring rejected the connection (reason: ${lastRingError.message}). Enter your Pubky public key to continue:`
        : 'Pubky Ring embed not detected. Enter your Pubky public key to continue:';
      if (invalidRingRequest) {
        identityHint?.classList.add('identity-panel__hint--warn');
        identityHint.textContent = 'Pubky Ring rejected the configured request. Update the data-request attribute (pubky://<user>/<path>) or paste your public key manually.';
      }
      identityHint?.classList.add('identity-panel__hint--warn');
      const manualKey = window.prompt(manualPrompt);
      if (!manualKey) {
        updateIdentityUI('Pubky Ring connection cancelled.');
        return;
      }
      const manualIdentity = normalizeIdentity({ pubkey: manualKey, source: 'manual' });
      if (!manualIdentity) {
        updateIdentityUI('Please provide a valid Pubky public key.');
        return;
      }
      identity = manualIdentity;
    } else {
      const normalized = normalizeIdentity(ringResponse);
      if (!normalized) {
        updateIdentityUI('Pubky Ring did not return a usable identity.');
        return;
      }
      normalized.source = normalized.source || 'ring';
      identity = normalized;
    }

    persistIdentity();
    updateIdentityUI();
    identityHint?.classList.remove('identity-panel__hint--warn');
  } catch (error) {
    console.error('Failed to connect to Pubky Ring', error);
    updateIdentityUI('Failed to connect to Pubky Ring. Please try again.');
  }
}

function disconnectIdentity() {
  clearIdentity();
  updateIdentityUI('Disconnected from Pubky Ring.');
}

connectButton?.addEventListener('click', () => {
  connectIdentity();
});

disconnectButton?.addEventListener('click', () => {
  disconnectIdentity();
});

runAiJudgeAllButton?.addEventListener('click', () => {
  scoreAllProjects();
});

restoreIdentity();
updateIdentityUI();

fetchProjects().catch((error) => {
  projectContainer.innerHTML = `<p class="error">${error.message}</p>`;
});
