// public/host.js
const socket = io();
let gameId = null;
let payload = null;

// Utility to get element by ID
const byId = id => document.getElementById(id);
const el = {
  title: byId('title'),
  create: byId('create'),
  jsonFile: byId('jsonFile'),
  createBtn: byId('createBtn'),
  createMsg: byId('createMsg'),
  lobby: byId('lobby'),
  players: byId('players'),
  startBtn: byId('startBtn'),
  joinLink: byId('joinLink'),
  gameIdText: byId('gameId'),
  play: byId('play'),
  qText: byId('qText'),
  qImage: byId('qImage'),
  answers: byId('answers'),
  qIndex: byId('qIndex'),
  qTotal: byId('qTotal'),
  nextBtn: byId('nextBtn'),
  music: byId('music'),
  reveal: byId('reveal'),
  leaderboard: byId('leaderboard'),
  board: byId('board'),
  over: byId('over'),
  finalBoard: byId('finalBoard'),
  cancelled: byId('cancelled'),
  cancelReason: byId('cancelReason'),
  backToCreateBtn: document.getElementById('backToCreateBtn')
};

// Disable create button until file is selected
el.jsonFile.addEventListener('change', () => {
  el.createBtn.disabled = !el.jsonFile.files[0];
  el.createMsg.textContent = '';
});

// Handle create game
el.createBtn.addEventListener('click', async () => {
  const file = el.jsonFile.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    payload = JSON.parse(text);
  } catch {
    el.createMsg.textContent = 'Invalid JSON.';
    return;
  }
  socket.emit('host:createGame', payload, (res) => {
  if (!res.ok) {
    el.createMsg.textContent = res.error || 'Failed to create game.';
    return;
  }
    gameId = res.gameId;
    el.title.textContent = payload.title || 'Quiz';
    el.joinLink.textContent = `${location.origin}/player.html?game=${gameId}`;
    el.gameIdText.textContent = gameId;

    el.lobby.classList.remove('hidden');
    // SAFELY hide the create section:
    if (el.create) el.create.classList.add('hidden');

    el.startBtn.disabled = false;
    });
});

// Handle start game
el.startBtn.addEventListener('click', () => {
  if (!gameId) return;
  socket.emit('host:startGame', { gameId });
});

// Listen for lobby updates
socket.on('lobby:update', ({ players, gameId: gid, title }) => {
  if (gameId && gid !== gameId) return;
  el.players.innerHTML = '';
  players.forEach(name => {
    const li = document.createElement('li');
    li.textContent = name;
    el.players.appendChild(li);
  });
});

// Game started
socket.on('game:started', () => {
  el.lobby.classList.add('hidden');
  // Do NOT hide leaderboard here
  el.play.classList.remove('hidden');
});

// Handle question display and answers
socket.on('question:show', (q) => {
  // Prepare UI
  el.nextBtn.classList.add('hidden');
  // Do NOT hide leaderboard here
  el.over.classList.add('hidden');

  el.qText.textContent = q.text;
  el.qIndex.textContent = (q.index + 1);
  el.qTotal.textContent = q.total;

  if (q.imageUrl) {
    el.qImage.src = q.imageUrl;
    el.qImage.classList.remove('hidden');
  } else {
    el.qImage.classList.add('hidden');
  }

  el.answers.innerHTML = '';
  // Assign global color/shape and randomize order
  let options = q.options.map((opt, idx) => ({
    ...opt,
    color: GLOBAL_ANSWER_STYLES[idx % GLOBAL_ANSWER_STYLES.length].color,
    shape: GLOBAL_ANSWER_STYLES[idx % GLOBAL_ANSWER_STYLES.length].shape
  }));
  options = shuffleArray(options);

  options.forEach((opt) => {
    const btn = document.createElement('button');
    btn.className = `answer ${opt.color}`;
    btn.disabled = true; // host doesn't answer; just shows layout
    btn.innerHTML = `<span class="shape">${opt.shape}</span> <span class="label">${opt.label}</span>`;
    btn.dataset.id = opt.id; // assign option id for later lookup
    el.answers.appendChild(btn);
  });

  // Start music
  try { el.music.currentTime = 0; el.music.play(); } catch {}

  // Show progress dot in bottom-left (already via qIndex/qTotal)
});

// Store current question id for answer tracking
socket.on('question:reveal', ({ correctOptionIds, leaderboard }) => {
  // Stop music, play reveal
  try { el.music.pause(); } catch {}
  try { el.reveal.currentTime = 0; el.reveal.play(); } catch {}

  // Highlight correct and wrong answers using data-id
  [...el.answers.children].forEach((btn) => {
    const optId = btn.dataset.id;
    if (correctOptionIds.includes(optId)) {
      btn.classList.add('correct');
    } else {
      btn.classList.add('wrong');
    }
  });

  // Leaderboard
  el.board.innerHTML = '';
  leaderboard.forEach((p, i) => {
    const li = document.createElement('li');
    li.textContent = `${p.name} - ${p.score.toLocaleString()}`;
    if (p.lastCorrect) li.classList.add('correctish');
    el.board.appendChild(li);
  });
  el.leaderboard.classList.remove('hidden');
});

// Allow advancing to next question
socket.on('host:canAdvance', () => {
  el.nextBtn.classList.remove('hidden');
});

// Handle next question
el.nextBtn.addEventListener('click', () => {
  // Remove correct highlight before advancing
  [...el.answers.children].forEach(btn => btn.classList.remove('correct'));
  if (!gameId) return;
  socket.emit('host:next', { gameId });
});

// Game over
socket.on('game:over', ({ leaderboard }) => {
  el.play.classList.add('hidden');
  el.leaderboard.classList.add('hidden');
  el.over.classList.remove('hidden');
  el.finalBoard.innerHTML = '';
  leaderboard.forEach((p, i) => {
    const li = document.createElement('li');
    li.textContent = `#${i + 1} ${p.name} — ${p.score.toLocaleString()}`;
    el.finalBoard.appendChild(li);
  });
  // Play end sound effect
  const endAudio = document.getElementById('end');
  if (endAudio) {
    try { endAudio.currentTime = 0; endAudio.play(); } catch {}
  }
});

// Game cancelled
socket.on('game:cancelled', ({ reason }) => {
  el.cancelReason.textContent = reason || 'Game ended.';
  el.cancelled.classList.remove('hidden');
});

// Back to create new game
if (el.backToCreateBtn) {
  el.backToCreateBtn.addEventListener('click', () => {
    // Show create section, hide others
    if (el.create) el.create.classList.remove('hidden');
    if (el.lobby) el.lobby.classList.add('hidden');
    if (el.play) el.play.classList.add('hidden');
    if (el.leaderboard) el.leaderboard.classList.add('hidden');
    if (el.over) el.over.classList.add('hidden');
    if (el.cancelled) el.cancelled.classList.add('hidden');
    // Optionally reset file input and messages
    if (el.jsonFile) el.jsonFile.value = '';
    if (el.createMsg) el.createMsg.textContent = '';
    if (el.createBtn) el.createBtn.disabled = true;
    // Reset title
    el.title.textContent = 'Host a Game';
  });
}

// Global color/shape list
const GLOBAL_ANSWER_STYLES = [
  { color: 'red',    shape: '■' },
  { color: 'blue',   shape: '♦' },
  { color: 'yellow', shape: '●' },
  { color: 'green',  shape: '▲' }
];

// Utility to shuffle an array (Fisher-Yates)
function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}