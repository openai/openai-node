const STORAGE_KEY = 'spanish-speaking-gym-v1';

const starterPhrases = [
  ['repair-001', 'No entiendo.', "I don't understand.", 'repair'],
  ['repair-002', 'Más despacio, por favor.', 'Slower, please.', 'repair'],
  ['repair-003', 'Otra vez.', 'Again.', 'repair'],
  ['repair-004', '¿Cómo se dice...?', 'How do you say...?', 'repair'],
  ['identity-001', 'Me llamo...', 'My name is...', 'identity'],
  ['identity-002', 'Soy de...', 'I am from...', 'identity'],
  ['identity-003', 'Vivo en...', 'I live in...', 'identity'],
  ['work-001', 'Trabajo en...', 'I work in...', 'work'],
  ['needs-001', 'Quiero...', 'I want...', 'needs'],
  ['needs-002', 'Necesito...', 'I need...', 'needs'],
  ['needs-003', 'Busco...', 'I am looking for...', 'needs'],
  ['food-001', 'Tengo hambre.', 'I am hungry.', 'food'],
  ['routine-001', 'Tengo sueño.', 'I am sleepy.', 'routine'],
  ['questions-001', '¿Dónde está...?', 'Where is...?', 'questions'],
  ['questions-002', '¿Cuánto cuesta?', 'How much does it cost?', 'questions'],
  ['preferences-001', 'Me gusta...', 'I like...', 'preferences'],
  ['preferences-002', 'No me gusta...', "I don't like...", 'preferences'],
  ['routine-002', 'Voy a...', 'I am going to...', 'routine'],
  ['work-002', 'Hoy trabajo.', 'Today I work.', 'work'],
  ['routine-003', 'Mañana estudio.', 'Tomorrow I study.', 'routine'],
].map(([id, spanish, english, category]) => ({
  id,
  spanish,
  english,
  category,
  difficulty: 'beginner',
  reviewStatus: 'new',
  lastPracticedDate: null,
  successfulRecalls: 0,
  failedRecalls: 0,
}));

const starterRoleplays = [
  {
    id: 'roleplay-001',
    title: 'Introduce Yourself',
    goal: 'Say your name, where you live, and one thing you like.',
    usefulPhrases: ['Me llamo...', 'Vivo en...', 'Me gusta...'],
    prompt: 'Introduce yourself in 30 seconds. Keep it simple and clear.',
    checklist: ['Say your name', 'Say where you live', 'Say one thing you like'],
    difficulty: 'beginner',
  },
  {
    id: 'roleplay-002',
    title: 'Order Coffee',
    goal: 'Order a coffee politely and ask the price.',
    usefulPhrases: ['Quiero un café, por favor.', '¿Cuánto cuesta?', 'Gracias.'],
    prompt: 'You are at a café. Ask for a drink, ask the price, and say thanks.',
    checklist: ['Order one item', 'Ask the price', 'Say thank you'],
    difficulty: 'beginner',
  },
  {
    id: 'roleplay-003',
    title: 'Ask Where the Bathroom Is',
    goal: 'Ask where the bathroom is politely.',
    usefulPhrases: ['¿Dónde está el baño?', 'Gracias.', 'No entiendo.'],
    prompt: 'You are in a restaurant. Ask for the bathroom and confirm directions.',
    checklist: ['Ask where it is', 'Repeat if needed', 'Thank the person'],
    difficulty: 'beginner',
  },
];

const dayTypes = ['Lesson-heavy day', 'Conversation-heavy day', 'Listening-calibration day'];

function ensureStateShape(rawState) {
  const hydrated = rawState || {};
  hydrated.phrases ||= starterPhrases;
  hydrated.roleplays ||= starterRoleplays;
  hydrated.weakPhrases ||= [];
  hydrated.weeklyBenchmarks ||= [];
  hydrated.sessionLog ||= {};
  hydrated.roleplayProgress ||= {};
  hydrated.dailyChallenges ||= {};
  hydrated.settings ||= {
    voiceEnabled: true,
    speechRecognitionEnabled: false,
    enableOptionalRealtime: false,
  };
  hydrated.stats ||= { xp: 0, streak: 0, lastActiveDate: null };
  return hydrated;
}

function daysBetween(a, b) {
  const start = new Date(`${a}T00:00:00Z`).getTime();
  const end = new Date(`${b}T00:00:00Z`).getTime();
  return Math.round((end - start) / 86400000);
}

function markDailyActivity() {
  const today = todayISO();
  if (state.stats.lastActiveDate === today) return;
  if (!state.stats.lastActiveDate) state.stats.streak = 1;
  else {
    const gap = daysBetween(state.stats.lastActiveDate, today);
    if (gap === 1) state.stats.streak += 1;
    else if (gap > 1) state.stats.streak = 1;
  }
  state.stats.lastActiveDate = today;
}

function awardXP(points) {
  state.stats.xp += points;
  markDailyActivity();
  save();
}

function renderStatsBar() {
  const xpForNext = 50;
  const progress = state.stats.xp % xpForNext;
  const level = Math.floor(state.stats.xp / xpForNext) + 1;
  app.append(
    card(`
      <h2>Practice Stats</h2>
      <p><span class="badge">Level ${level}</span><span class="badge">🔥 ${
        state.stats.streak
      }-day streak</span></p>
      <p class="small">${state.stats.xp} XP total · ${xpForNext - progress} XP to next level</p>
      <div class="progress"><span style="width: ${(progress / xpForNext) * 100}%"></span></div>
    `),
  );
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) throw new Error('missing');
    return ensureStateShape(JSON.parse(raw));
  } catch {
    return ensureStateShape();
  }
}

let state = loadState();
const app = document.getElementById('app');
const navButtons = [...document.querySelectorAll('.nav button')];
let route = '/';
let deferredInstallPrompt = null;

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // The app still works without offline support when opened from file:// or unsupported browsers.
    });
  });
}

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  if (route === '/settings') render();
});

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function getDayType() {
  const epochDays = Math.floor(new Date(todayISO()).getTime() / 86400000);
  return dayTypes[epochDays % 3];
}

function card(html) {
  const node = document.getElementById('card-template').content.firstElementChild.cloneNode();
  node.innerHTML = html;
  return node;
}

function speak(text) {
  if (!state.settings.voiceEnabled || !('speechSynthesis' in window)) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'es-419';
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

function setRoute(next) {
  route = next;
  navButtons.forEach((b) => b.classList.toggle('active', b.dataset.route === route));
  render();
}

navButtons.forEach((b) => b.addEventListener('click', () => setRoute(b.dataset.route)));

function renderHome() {
  const dateKey = todayISO();
  state.sessionLog[dateKey] ||= { completedBlocks: [] };
  const blocks = [
    ['pronunciation', '3 minutes pronunciation drill'],
    ['input', '8 minutes structured input'],
    ['roleplay', '12 minutes speaking / roleplay'],
    ['review', '5 minutes phrase review'],
    ['recap', '2 minutes recap'],
  ];

  const session = card(`
    <h2>Today's 30-Minute Session</h2>
    <p><strong>${dateKey}</strong> · <span class="badge">${getDayType()}</span></p>
    <ul>
      ${blocks
        .map(
          ([id, label]) => `<li>
            <label><input type="checkbox" data-block="${id}" ${
              state.sessionLog[dateKey].completedBlocks.includes(id) ? 'checked' : ''
            }/> ${label}</label>
          </li>`,
        )
        .join('')}
    </ul>
    <p class="small">Complete the blocks in order. Speak every response out loud first.</p>
  `);

  session.querySelectorAll('input[type="checkbox"]').forEach((el) => {
    el.addEventListener('change', () => {
      const block = el.dataset.block;
      const done = state.sessionLog[dateKey].completedBlocks;
      if (el.checked && !done.includes(block)) done.push(block);
      if (!el.checked) state.sessionLog[dateKey].completedBlocks = done.filter((x) => x !== block);
      awardXP(2);
    });
  });

  const completedChallenge = Boolean(state.dailyChallenges[dateKey]);
  const promptPhrase = state.phrases[Math.floor(Math.random() * state.phrases.length)];
  const challenge = card(`
    <h3>Daily Quick Challenge</h3>
    <p><strong>Say this idea in Spanish:</strong> ${promptPhrase.english}</p>
    <details><summary>Show answer</summary><p>${promptPhrase.spanish}</p></details>
    <button class="primary" ${completedChallenge ? 'disabled' : ''} data-action="complete-challenge">
      ${completedChallenge ? 'Completed today ✅' : 'Mark challenge complete (+8 XP)'}
    </button>
  `);

  challenge.querySelector('[data-action="complete-challenge"]').addEventListener('click', () => {
    state.dailyChallenges[dateKey] = true;
    awardXP(8);
    render();
  });

  app.append(session, challenge);
}

function renderPhrases() {
  const section = card(`
    <h2>Phrase Chunk Bank</h2>
    <p class="small">Tap 🔊 to hear Spanish. Mark recall after speaking.</p>
    <div class="row">
      <input id="phrase-search" placeholder="Search Spanish or English" />
      <select id="phrase-category-filter">
        <option value="all">All categories</option>
        ${[...new Set(state.phrases.map((p) => p.category))]
          .map((c) => `<option value="${c}">${c}</option>`)
          .join('')}
      </select>
    </div>
  `);
  const list = document.createElement('div');

  const renderPhraseList = () => {
    list.innerHTML = '';
    const query = section.querySelector('#phrase-search').value.trim().toLowerCase();
    const category = section.querySelector('#phrase-category-filter').value;
    const filtered = state.phrases.filter((p) => {
      const matchesQuery =
        !query || p.spanish.toLowerCase().includes(query) || p.english.toLowerCase().includes(query);
      const matchesCategory = category === 'all' || p.category === category;
      return matchesQuery && matchesCategory;
    });

    filtered.forEach((p) => {
      const item = card(`
      <h3>${p.spanish}</h3>
      <p>${p.english}</p>
      <p><span class="badge">${p.category}</span><span class="badge">${p.difficulty}</span></p>
      <p class="small">✅ ${p.successfulRecalls} successful · ❌ ${p.failedRecalls} failed</p>
      <div class="row">
        <button data-action="speak">🔊 Play</button>
        <button class="success" data-action="easy">Easy</button>
        <button class="danger" data-action="hard">Hard</button>
      </div>
    `);

      item.querySelector('[data-action="speak"]').addEventListener('click', () => speak(p.spanish));
      item.querySelector('[data-action="easy"]').addEventListener('click', () => {
        p.successfulRecalls += 1;
        p.reviewStatus = 'improving';
        p.lastPracticedDate = todayISO();
        awardXP(3);
        render();
      });
      item.querySelector('[data-action="hard"]').addEventListener('click', () => {
        p.failedRecalls += 1;
        p.reviewStatus = 'weak';
        p.lastPracticedDate = todayISO();
        awardXP(1);
        render();
      });

      list.append(item);
    });
  };

  section.querySelector('#phrase-search').addEventListener('input', renderPhraseList);
  section.querySelector('#phrase-category-filter').addEventListener('change', renderPhraseList);
  renderPhraseList();
  app.append(section, list);
}

function renderDrills() {
  const frames = [
    ['Quiero ___', ['agua', 'comida mexicana', 'un café']],
    ['Necesito ___', ['ayuda', 'un taxi', 'tiempo']],
    ['Busco ___', ['la estación', 'un mercado', 'el baño']],
    ['¿Dónde está ___?', ['el baño', 'la calle principal', 'la farmacia']],
    ['Me gusta ___', ['la música', 'el café', 'caminar']],
    ['No me gusta ___', ['esperar', 'el ruido', 'correr']],
    ['Vivo en ___', ['Chicago', 'Austin', 'Miami']],
    ['Voy a ___', ['trabajar', 'estudiar', 'comer']],
  ];

  app.append(
    card(`
      <h2>Substitution Drills</h2>
      <p class="small">Say each phrase out loud. Then mark Easy or Hard.</p>
    `),
  );

  frames.forEach(([frame, substitutions]) => {
    const phrase = frame.replace('___', substitutions[Math.floor(Math.random() * substitutions.length)]);
    const panel = card(`
      <h3>${phrase}</h3>
      <div class="row">
        <button data-action="speak">🔊 Play</button>
        <button data-action="add-weak">Add to weak phrases</button>
        <button class="success" data-action="easy">Easy</button>
        <button class="danger" data-action="hard">Hard</button>
      </div>
      <p class="small" data-msg=""></p>
    `);

    panel.querySelector('[data-action="speak"]').addEventListener('click', () => speak(phrase));
    panel.querySelector('[data-action="easy"]').addEventListener('click', () => {
      panel.querySelector('[data-msg=""]').textContent = 'Great. Repeat once faster.';
      awardXP(2);
    });
    panel.querySelector('[data-action="hard"]').addEventListener('click', () => {
      state.weakPhrases.push({
        englishIdea: `I want to say: ${phrase}`,
        spanishTargetPhrase: phrase,
        category: 'drill',
        dateAdded: todayISO(),
        practiceCount: 0,
        masteryStatus: 'new',
      });
      awardXP(1);
      panel.querySelector('[data-msg=""]').textContent = 'Saved to weak phrases.';
    });
    panel.querySelector('[data-action="add-weak"]').addEventListener('click', () => {
      state.weakPhrases.push({
        englishIdea: `I want to say: ${phrase}`,
        spanishTargetPhrase: phrase,
        category: 'drill',
        dateAdded: todayISO(),
        practiceCount: 0,
        masteryStatus: 'new',
      });
      awardXP(1);
      panel.querySelector('[data-msg=""]').textContent = 'Saved to weak phrases.';
    });

    app.append(panel);
  });
}

function renderRoleplays() {
  app.append(
    card(
      '<h2>Roleplay Cards</h2><p class="small">Use checklist. Speak out loud before checking each step.</p>',
    ),
  );

  state.roleplays.forEach((r) => {
    state.roleplayProgress[r.id] ||= [];
    const done = state.roleplayProgress[r.id];
    const panel = card(`
      <h3>${r.title}</h3>
      <p><strong>Goal:</strong> ${r.goal}</p>
      <p><strong>Prompt:</strong> ${r.prompt}</p>
      <p><strong>Useful phrases:</strong> ${r.usefulPhrases.join(' · ')}</p>
      <ul>
        ${r.checklist
          .map(
            (item, idx) =>
              `<li><label><input type="checkbox" data-step="${idx}" ${
                done.includes(idx) ? 'checked' : ''
              }/> ${item}</label></li>`,
          )
          .join('')}
      </ul>
      <p class="small">${done.length}/${r.checklist.length} completed</p>
    `);

    panel.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      input.addEventListener('change', () => {
        const idx = Number(input.dataset.step);
        if (input.checked && !done.includes(idx)) done.push(idx);
        if (!input.checked) state.roleplayProgress[r.id] = done.filter((x) => x !== idx);
        awardXP(input.checked ? 4 : 0);
        render();
      });
    });

    app.append(panel);
  });
}

function renderWeakPhrases() {
  const form = card(`
    <h2>Weak Phrase Log</h2>
    <form id="weak-form">
      <label>English idea<input name="englishIdea" required /></label>
      <label>Spanish target phrase<input name="spanishTargetPhrase" required /></label>
      <label>Category
        <select name="category">
          <option value="repair">Repair and control</option>
          <option value="identity">Identity</option>
          <option value="needs">Needs and wants</option>
          <option value="questions">Questions</option>
          <option value="routine">Preferences and routine</option>
          <option value="food">Food and drink</option>
          <option value="directions">Directions and places</option>
          <option value="work">Work basics</option>
        </select>
      </label>
      <button class="primary" type="submit">Add weak phrase</button>
    </form>
  `);

  form.querySelector('#weak-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const data = new FormData(e.target);
    state.weakPhrases.unshift({
      englishIdea: data.get('englishIdea'),
      spanishTargetPhrase: data.get('spanishTargetPhrase'),
      category: data.get('category'),
      dateAdded: todayISO(),
      practiceCount: 0,
      masteryStatus: 'new',
    });
    awardXP(2);
    render();
  });

  app.append(form);

  state.weakPhrases.forEach((w, i) => {
    const item = card(`
      <h3>${w.spanishTargetPhrase}</h3>
      <p>${w.englishIdea}</p>
      <p><span class="badge">${w.category}</span> <span class="badge">${w.masteryStatus}</span></p>
      <p class="small">Added ${w.dateAdded} · practiced ${w.practiceCount} times</p>
      <div class="row">
        <button data-action="practice">+1 practice</button>
        <button class="success" data-action="mastered">Mark mastered</button>
        <button class="danger" data-action="remove">Remove</button>
      </div>
    `);

    item.querySelector('[data-action="practice"]').addEventListener('click', () => {
      w.practiceCount += 1;
      awardXP(1);
      render();
    });
    item.querySelector('[data-action="mastered"]').addEventListener('click', () => {
      w.masteryStatus = 'mastered';
      awardXP(5);
      render();
    });
    item.querySelector('[data-action="remove"]').addEventListener('click', () => {
      state.weakPhrases.splice(i, 1);
      save();
      render();
    });

    app.append(item);
  });
}

function renderProgress() {
  const milestones = [
    ['Day 14', 'Record a 20–30 second self-introduction.'],
    ['Day 30', 'Answer 8–10 fixed beginner questions.'],
    ['Day 60', 'Complete a 2-minute guided roleplay.'],
    ['Day 90', 'Hold a 3–4 minute supportive conversation on familiar topics.'],
  ];

  const isSunday = new Date().getUTCDay() === 0;
  app.append(
    card(
      `<h2>Progress Milestones</h2><p class="small">${
        isSunday ? 'Sunday benchmark day ✅' : 'Next benchmark prompt appears on Sunday.'
      }</p>`,
    ),
  );

  milestones.forEach(([day, text]) => app.append(card(`<h3>${day}</h3><p>${text}</p>`)));

  const benchmark = card(`
    <h3>Weekly Speaking Benchmark</h3>
    <form id="benchmark-form">
      <label>Response speed (1-5)<input name="responseSpeed" type="number" min="1" max="5" required /></label>
      <label>Pronunciation (1-5)<input name="pronunciation" type="number" min="1" max="5" required /></label>
      <label>Confidence (1-5)<input name="confidence" type="number" min="1" max="5" required /></label>
      <label>Number of pauses<input name="pauses" type="number" min="0" required /></label>
      <label>Phrases remembered<input name="remembered" /></label>
      <label>Phrases forgotten<input name="forgotten" /></label>
      <button class="primary" type="submit">Save weekly benchmark</button>
    </form>
  `);

  benchmark.querySelector('#benchmark-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const data = new FormData(e.target);
    state.weeklyBenchmarks.unshift({
      date: todayISO(),
      responseSpeed: Number(data.get('responseSpeed')),
      pronunciation: Number(data.get('pronunciation')),
      confidence: Number(data.get('confidence')),
      pauses: Number(data.get('pauses')),
      remembered: data.get('remembered'),
      forgotten: data.get('forgotten'),
    });
    awardXP(6);
    render();
  });
  app.append(benchmark);

  state.weeklyBenchmarks.slice(0, 6).forEach((b) => {
    app.append(
      card(`
        <h3>Benchmark ${b.date}</h3>
        <p>Speed ${b.responseSpeed}/5 · Pronunciation ${b.pronunciation}/5 · Confidence ${b.confidence}/5</p>
        <p class="small">Pauses: ${b.pauses}</p>
        <p class="small">Remembered: ${b.remembered || '-'}</p>
        <p class="small">Forgotten: ${b.forgotten || '-'}</p>
      `),
    );
  });
}

function renderSettings() {
  const hasSpeechRecognition = 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
  const appUrl = window.location.href;
  const canInstall = Boolean(deferredInstallPrompt);
  const settings = card(`
    <h2>Voice Settings</h2>
    <p><strong>TTS available:</strong> ${'speechSynthesis' in window ? 'Yes' : 'No'}</p>
    <p><strong>Speech recognition available:</strong> ${
      hasSpeechRecognition ? 'Yes' : 'No (manual text fallback active)'
    }</p>

    <label><input id="voice-enabled" type="checkbox" ${
      state.settings.voiceEnabled ? 'checked' : ''
    }/> Enable browser text-to-speech</label>
    <label><input id="stt-enabled" type="checkbox" ${
      state.settings.speechRecognitionEnabled ? 'checked' : ''
    } ${!hasSpeechRecognition ? 'disabled' : ''}/> Enable browser speech recognition (optional)</label>
    <label><input id="realtime-enabled" type="checkbox" ${
      state.settings.enableOptionalRealtime ? 'checked' : ''
    }/> Enable optional OpenAI Realtime adapter (future, not required)</label>

    <h3>Connect to your mobile app</h3>
    <p class="small">Open this URL on your phone, then use Add to Home Screen / Install App. The app shell and practice data are local-first and work offline after the first load.</p>
    <label>Mobile connection URL<input id="mobile-url" readonly value="${appUrl}" /></label>
    <div class="row">
      <button id="copy-mobile-url">Copy mobile URL</button>
      <button id="install-app" class="primary" ${canInstall ? '' : 'disabled'}>${
        canInstall ? 'Install mobile app' : 'Use browser Add to Home Screen'
      }</button>
    </div>
    <p id="connection-status" class="small"></p>

    <div class="row">
      <button id="test-voice">Test Spanish voice</button>
      <button id="reset" class="danger">Reset local data</button>
    </div>
    <p class="small">MVP works fully without paid APIs. Optional OpenAI adapter should be wired later through a backend route with env vars.</p>
  `);

  settings.querySelector('#voice-enabled').addEventListener('change', (e) => {
    state.settings.voiceEnabled = e.target.checked;
    save();
  });
  settings.querySelector('#stt-enabled').addEventListener('change', (e) => {
    state.settings.speechRecognitionEnabled = e.target.checked;
    save();
  });
  settings.querySelector('#realtime-enabled').addEventListener('change', (e) => {
    state.settings.enableOptionalRealtime = e.target.checked;
    save();
  });
  settings.querySelector('#copy-mobile-url').addEventListener('click', async () => {
    const status = settings.querySelector('#connection-status');
    try {
      await navigator.clipboard.writeText(appUrl);
      status.textContent = 'Copied. Send this link to your phone to finish connecting.';
    } catch {
      settings.querySelector('#mobile-url').select();
      status.textContent = 'Copy unavailable. Select the URL above and send it to your phone.';
    }
  });
  settings.querySelector('#install-app').addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    render();
  });
  settings
    .querySelector('#test-voice')
    .addEventListener('click', () => speak('Quiero practicar español todos los días.'));
  settings.querySelector('#reset').addEventListener('click', () => {
    localStorage.removeItem(STORAGE_KEY);
    state = loadState();
    render();
  });

  app.append(settings);
}

function render() {
  app.innerHTML = '';
  renderStatsBar();
  if (route === '/') renderHome();
  else if (route === '/phrases') renderPhrases();
  else if (route === '/drills') renderDrills();
  else if (route === '/roleplays') renderRoleplays();
  else if (route === '/weak-phrases') renderWeakPhrases();
  else if (route === '/progress') renderProgress();
  else if (route === '/settings') renderSettings();
}

render();
